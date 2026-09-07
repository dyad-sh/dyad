import {
  APICallError,
  InvalidArgumentError,
  LoadAPIKeyError,
  NoSuchModelError,
  TypeValidationError,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { DYAD_INTERNAL_REQUEST_ID_HEADER } from "./provider_options";

const logger = log.scope("fallback_model");
const MAX_LOG_FIELD_LENGTH = 500;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 10_000;

// Types

/**
 * The model-derived subset of call options — what a model should receive
 * because of what it is, as opposed to what the request is. Everything else
 * (prompt, tools, headers, request metadata) passes through unchanged.
 */
export interface FallbackModelCallOptions {
  temperature?: number;
  maxOutputTokens?: number;
  providerOptions?: Record<string, unknown>;
}

interface FallbackSettings {
  models: Array<LanguageModel>;
  /**
   * Per-model call-option overrides, parallel to `models`. The caller's
   * options are computed for the PRIMARY selection and encode that model's
   * constraints; an entry here expresses what the model at the same index
   * would have received had it been selected as primary. Models without an
   * entry get the conservative default on cross-provider failover:
   * `temperature` and `maxOutputTokens` stripped, everything else forwarded.
   */
  modelCallOptions?: Array<FallbackModelCallOptions | undefined>;
}

interface RetryState {
  attemptNumber: number;
  attemptsByModel: number[];
  errors: Array<{ modelId: string; error: unknown }>;
}

interface StreamResult {
  stream: ReadableStream<LanguageModelV3StreamPart>;
  request?: { body?: unknown };
  response?: { headers?: Record<string, string> };
}

interface RecoveryDecision {
  kind: "retry-same" | "fallback-next";
  failedModelId: string;
  nextModelId: string;
}

export type FallbackFailureAction = "retry-same" | "fallback-next" | "fail";

const RETRY_SAME_STATUS_CODES = new Set([
  408, // Request Timeout
  409, // Conflict
  429, // Too Many Requests
]);

const RETRY_SAME_ERROR_PATTERNS = [
  "overloaded",
  "service unavailable",
  "bad gateway",
  "too many requests",
  "internal server error",
  "gateway timeout",
  "rate_limit",
  "capacity",
  "timeout",
  "server_error",
  "econnrefused",
  "enotfound",
  "econnreset",
  "epipe",
  "etimedout",
];

const FALLBACK_NEXT_ERROR_PATTERNS = [
  "model_not_found",
  "model not found",
  "model_not_available",
  "model is not available",
  "no such model",
  "unsupported model",
];

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function normalizeLogField(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;

  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_LOG_FIELD_LENGTH);
}

/**
 * Produce a compact error description for fallback logs. Avoid serializing the
 * full error because provider errors can contain request bodies and headers.
 */
export function formatFallbackErrorForLog(error: unknown): string {
  if (!isRecord(error)) {
    return `message=${normalizeLogField(error) ?? "unknown error"}`;
  }

  const inner = isRecord(error.error) ? error.error : undefined;
  const cause = isRecord(error.cause) ? error.cause : undefined;
  const response = isRecord(error.response) ? error.response : undefined;
  const responseHeaders = isRecord(response?.headers)
    ? response.headers
    : undefined;
  const directResponseHeaders = isRecord(error.responseHeaders)
    ? error.responseHeaders
    : undefined;

  const fields = {
    status:
      error.statusCode ??
      error.status ??
      response?.status ??
      inner?.statusCode ??
      inner?.status,
    providerRequestId:
      error.requestId ??
      error.request_id ??
      inner?.requestId ??
      inner?.request_id ??
      responseHeaders?.["x-request-id"] ??
      directResponseHeaders?.["x-request-id"] ??
      directResponseHeaders?.["request-id"],
    code: error.code ?? inner?.code ?? cause?.code,
    type: error.type ?? inner?.type ?? cause?.type,
    message:
      error.message ?? inner?.message ?? cause?.message ?? "unknown error",
    cause:
      cause?.message && cause.message !== error.message
        ? cause.message
        : undefined,
  };

  return Object.entries(fields)
    .map(([key, value]) => {
      const normalized = normalizeLogField(value);
      return normalized ? `${key}=${normalized}` : undefined;
    })
    .filter((field): field is string => Boolean(field))
    .join(" ");
}

function getErrorDetails(error: unknown): {
  statusCode?: number;
  errorString: string;
} {
  if (!isRecord(error)) {
    return { errorString: normalizeLogField(error)?.toLowerCase() ?? "" };
  }

  const inner = isRecord(error.error) ? error.error : undefined;
  const response = isRecord(error.response) ? error.response : undefined;
  const statusCode = [
    error.statusCode,
    error.status,
    response?.status,
    inner?.statusCode,
    inner?.status,
  ].find((value): value is number => typeof value === "number");
  const errorString = [
    error.message,
    error.code,
    error.type,
    inner?.message,
    inner?.code,
    inner?.type,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return { statusCode, errorString };
}

/**
 * Decide whether a failure should retry the current model, move to the next
 * model, or stop. Explicit model-unavailable signals take precedence over the
 * AI SDK's retryability flag. Unknown and deterministic request errors fail
 * closed.
 */
export function getFallbackFailureAction(
  error: unknown,
): FallbackFailureAction {
  if (!error) return "fail";

  try {
    if (APICallError.isInstance(error)) {
      if (error.statusCode === 404) return "fallback-next";
      const { errorString } = getErrorDetails(error);
      if (
        FALLBACK_NEXT_ERROR_PATTERNS.some((pattern) =>
          errorString.includes(pattern),
        )
      ) {
        return "fallback-next";
      }
      if (error.isRetryable) return "retry-same";
      return "fail";
    }

    if (NoSuchModelError.isInstance(error)) return "fallback-next";
    if (
      InvalidArgumentError.isInstance(error) ||
      LoadAPIKeyError.isInstance(error) ||
      TypeValidationError.isInstance(error) ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return "fail";
    }

    const { statusCode, errorString } = getErrorDetails(error);
    if (statusCode === 404) return "fallback-next";
    if (
      FALLBACK_NEXT_ERROR_PATTERNS.some((pattern) =>
        errorString.includes(pattern),
      )
    ) {
      return "fallback-next";
    }
    if (
      statusCode !== undefined &&
      (RETRY_SAME_STATUS_CODES.has(statusCode) || statusCode >= 500)
    ) {
      return "retry-same";
    }
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return "fail";
    }
    if (
      RETRY_SAME_ERROR_PATTERNS.some((pattern) => errorString.includes(pattern))
    ) {
      return "retry-same";
    }
    return "fail";
  } catch {
    return "fail";
  }
}

function getHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  const entry = Object.entries(headers ?? {}).find(
    ([headerName]) => headerName.toLowerCase() === name,
  );
  return entry?.[1];
}

function boundedRetryDelay(delayMs: number): number | undefined {
  if (!Number.isFinite(delayMs) || delayMs < 0) return undefined;
  return Math.min(Math.round(delayMs), MAX_RETRY_DELAY_MS);
}

function parseRetryAfter(value: string | undefined, nowMs: number) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return boundedRetryDelay(seconds * 1_000);

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt)
    ? undefined
    : boundedRetryDelay(Math.max(0, retryAt - nowMs));
}

function parseRateLimitReset(value: string | undefined, nowMs: number) {
  if (!value) return undefined;
  const reset = Number(value);
  if (!Number.isFinite(reset)) return undefined;

  if (reset > 1_000_000_000_000) {
    return boundedRetryDelay(Math.max(0, reset - nowMs));
  }
  if (reset > 1_000_000_000) {
    return boundedRetryDelay(Math.max(0, reset * 1_000 - nowMs));
  }
  return boundedRetryDelay(reset * 1_000);
}

export function getFallbackRetryDelayMs(
  error: unknown,
  sameModelAttempt: number,
  nowMs = Date.now(),
): number {
  const responseHeaders = APICallError.isInstance(error)
    ? error.responseHeaders
    : isRecord(error) && isRecord(error.responseHeaders)
      ? (error.responseHeaders as Record<string, string>)
      : undefined;
  const headerDelay =
    parseRetryAfter(getHeader(responseHeaders, "retry-after"), nowMs) ??
    parseRateLimitReset(getHeader(responseHeaders, "x-ratelimit-reset"), nowMs);

  return (
    headerDelay ??
    Math.min(
      DEFAULT_RETRY_DELAY_MS * 2 ** Math.max(0, sameModelAttempt - 1),
      MAX_RETRY_DELAY_MS,
    )
  );
}

export function defaultShouldRetryThisError(error: unknown): boolean {
  return getFallbackFailureAction(error) === "retry-same";
}

function getRequestId(options: LanguageModelV3CallOptions): string {
  const headers = options.headers as
    | Record<string, string | undefined>
    | undefined;
  return headers?.[DYAD_INTERNAL_REQUEST_ID_HEADER] ?? "unknown";
}

function getAbortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw getAbortReason(signal);
}

async function waitForRetryDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (delayMs === 0) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(getAbortReason(signal!)));
    const timeout = setTimeout(() => finish(resolve), delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function isStreamContentPart(part: LanguageModelV3StreamPart): boolean {
  return part.type !== "stream-start" && part.type !== "response-metadata";
}

export function createFallback(settings: FallbackSettings): LanguageModel {
  return new FallbackModel(settings);
}

class FallbackModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  private readonly settings: FallbackSettings;
  private currentModelIndex: number = 0;
  private lastModelReset: number = Date.now();
  private readonly modelResetInterval: number;
  private readonly maxAttemptsPerModel: number;
  private readonly maxAttempts: number;
  private isRetrying: boolean = false;

  constructor(settings: FallbackSettings) {
    // Validate settings
    if (!settings.models || settings.models.length === 0) {
      throw new DyadError(
        "At least one model must be provided in settings.models",
        DyadErrorKind.Validation,
      );
    }

    this.settings = settings;
    this.modelResetInterval = 3 * 60 * 1000; // Default: 3 minutes
    this.maxAttemptsPerModel = 2;
    this.maxAttempts = settings.models.length * this.maxAttemptsPerModel;
  }

  get modelId(): string {
    return this.getUnderlyingModel().modelId;
  }

  get provider(): string {
    return this.getUnderlyingModel().provider;
  }

  get supportedUrls():
    | Record<string, RegExp[]>
    | PromiseLike<Record<string, RegExp[]>> {
    return this.getUnderlyingModel().supportedUrls;
  }

  private getModelAtIndex(index: number): LanguageModelV3 {
    const model = this.settings.models[index];
    if (!model) {
      throw new DyadError(
        `Model at index ${index} not found`,
        DyadErrorKind.Internal,
      );
    }
    // The model is either a string (GatewayModelId) or LanguageModelV2/V3
    // In this fallback context, we only support actual model instances
    if (typeof model === "string") {
      throw new DyadError(
        "String model IDs are not supported in fallback model",
        DyadErrorKind.External,
      );
    }
    if (model.specificationVersion !== "v3") {
      throw new DyadError("Model is not a v3 model", DyadErrorKind.External);
    }
    return model;
  }

  private getUnderlyingModel(): LanguageModelV3 {
    return this.getModelAtIndex(this.currentModelIndex);
  }

  /**
   * Call options are resolved for the PRIMARY model before the request is made
   * (e.g. `getTemperature(settings.selectedModel)`), so they encode that
   * model's constraints, not the fallback's. Forwarding them verbatim across a
   * provider switch produces hard 400s — observed: a gpt-5.6 stream error
   * failed over to an Anthropic thinking model, which rejected the forwarded
   * `temperature` ("`temperature` may only be set to 1 when thinking is
   * enabled"), converting a recoverable blip into a fatal stream error.
   *
   * Apply the current model's `modelCallOptions` entry — including for index 0
   * when a pseudo-model such as Auto supplied the request's original options.
   * Without an entry, same-provider fallbacks keep the caller's options. A
   * cross-provider fallback strips `temperature` and `maxOutputTokens`, whose
   * accepted values vary by model/provider. This also applies to sticky-index
   * first attempts after a previous failover.
   */
  private optionsForCurrentModel(
    options: LanguageModelV3CallOptions,
  ): LanguageModelV3CallOptions {
    const overrides = this.settings.modelCallOptions?.[this.currentModelIndex];
    if (!overrides) {
      if (
        this.currentModelIndex === 0 ||
        this.getUnderlyingModel().provider === this.getModelAtIndex(0).provider
      ) {
        return options;
      }
      // No per-model knowledge on a cross-provider fallback: omit constraints
      // whose accepted values and caps differ between providers.
      const {
        temperature: _droppedTemperature,
        maxOutputTokens: _droppedMaxOutputTokens,
        ...rest
      } = options;
      return rest;
    }
    // Rebuild the model-derived subset as if this model had been primary.
    // Both scalar values are replaced: undefined means "unset", not "inherit
    // the primary's". Request-scoped provider options pass through, with any
    // explicit per-model provider options merged on top.
    const {
      temperature: _replacedTemperature,
      maxOutputTokens: _replacedMaxOutputTokens,
      ...rest
    } = options;
    return {
      ...rest,
      ...(overrides.temperature !== undefined
        ? { temperature: overrides.temperature }
        : {}),
      ...(overrides.maxOutputTokens !== undefined
        ? { maxOutputTokens: overrides.maxOutputTokens }
        : {}),
      ...(overrides.providerOptions
        ? {
            providerOptions: {
              ...options.providerOptions,
              ...overrides.providerOptions,
            } as LanguageModelV3CallOptions["providerOptions"],
          }
        : {}),
    };
  }

  private checkAndResetModel(): void {
    // Only reset if we're not currently in a retry cycle
    if (this.isRetrying) return;

    const now = Date.now();
    if (
      this.currentModelIndex !== 0 &&
      now - this.lastModelReset >= this.modelResetInterval
    ) {
      this.currentModelIndex = 0;
      this.lastModelReset = now;
    }
  }

  private startAttempt(state: RetryState): void {
    state.attemptNumber++;
    state.attemptsByModel[this.currentModelIndex]++;
  }

  private moveToNextAvailableModel(state: RetryState): boolean {
    for (let offset = 1; offset < this.settings.models.length; offset++) {
      const candidateIndex =
        (this.currentModelIndex + offset) % this.settings.models.length;
      if (state.attemptsByModel[candidateIndex] < this.maxAttemptsPerModel) {
        this.currentModelIndex = candidateIndex;
        return true;
      }
    }
    return false;
  }

  private prepareRecovery(
    action: FallbackFailureAction,
    state: RetryState,
  ): RecoveryDecision | null {
    const failedModelId = this.modelId;
    if (
      action === "retry-same" &&
      state.attemptsByModel[this.currentModelIndex] < this.maxAttemptsPerModel
    ) {
      return {
        kind: "retry-same",
        failedModelId,
        nextModelId: failedModelId,
      };
    }

    // A permanent model-specific failure, or an exhausted transient retry,
    // should not circle back to the same model during this request.
    state.attemptsByModel[this.currentModelIndex] = this.maxAttemptsPerModel;
    if (!this.moveToNextAvailableModel(state)) return null;

    return {
      kind: "fallback-next",
      failedModelId,
      nextModelId: this.modelId,
    };
  }

  private logRecovery(params: {
    decision: RecoveryDecision;
    state: RetryState;
    requestId: string;
    stage: "initial-request" | "stream";
    error: unknown;
    hasStreamedContent?: boolean;
  }): void {
    const { decision, state, requestId, stage, error, hasStreamedContent } =
      params;
    const errorDetails = formatFallbackErrorForLog(error);
    const streamDetails =
      hasStreamedContent === undefined
        ? ""
        : `, hasStreamedContent=${hasStreamedContent}`;

    if (decision.kind === "retry-same") {
      logger.warn(
        `Retrying model ${decision.failedModelId} (requestId=${requestId}, stage=${stage}${streamDetails}, modelAttempt=${state.attemptsByModel[this.currentModelIndex] + 1}/${this.maxAttemptsPerModel}, totalAttempt=${state.attemptNumber + 1}/${this.maxAttempts}, error="${errorDetails}")`,
      );
      return;
    }

    logger.warn(
      `Falling back from model ${decision.failedModelId} to ${decision.nextModelId} (requestId=${requestId}, stage=${stage}${streamDetails}, nextAttempt=${state.attemptNumber + 1}/${this.maxAttempts}, error="${errorDetails}")`,
    );
  }

  private async waitBeforeSameModelRetry(
    decision: RecoveryDecision,
    state: RetryState,
    error: unknown,
    abortSignal: AbortSignal | undefined,
  ): Promise<void> {
    if (decision.kind !== "retry-same") return;

    const delayMs = getFallbackRetryDelayMs(
      error,
      state.attemptsByModel[this.currentModelIndex],
    );
    await waitForRetryDelay(delayMs, abortSignal);
  }

  private exhaustedError(operationName: string, error: unknown): DyadError {
    const message = error instanceof Error ? error.message : String(error);
    return new DyadError(
      `All ${this.settings.models.length} models failed for ${operationName}. Last error: ${message}`,
      DyadErrorKind.External,
    );
  }

  private async retry<T>(
    operation: (state: RetryState) => Promise<T>,
    operationName: string,
    requestId: string,
    abortSignal: AbortSignal | undefined,
  ): Promise<T> {
    const state: RetryState = {
      attemptNumber: 0,
      attemptsByModel: this.settings.models.map(() => 0),
      errors: [],
    };

    this.isRetrying = true;

    try {
      while (state.attemptNumber < this.maxAttempts) {
        throwIfAborted(abortSignal);
        this.startAttempt(state);

        try {
          return await operation(state);
        } catch (error) {
          const failedModelId = this.modelId;
          state.errors.push({ modelId: failedModelId, error });
          const action = getFallbackFailureAction(error);
          if (action === "fail") {
            logger.warn(
              `Request error from model ${failedModelId}; not retrying or falling back (requestId=${requestId}, stage=initial-request, attempt=${state.attemptNumber}/${this.maxAttempts}, error="${formatFallbackErrorForLog(error)}")`,
            );
            throw error;
          }

          const decision = this.prepareRecovery(action, state);
          if (!decision) {
            logger.error(
              `All ${this.settings.models.length} models exhausted for ${operationName} after ${state.attemptNumber} attempts (requestId=${requestId}, error="${formatFallbackErrorForLog(error)}")`,
            );
            throw this.exhaustedError(operationName, error);
          }
          this.logRecovery({
            decision,
            state,
            requestId,
            stage: "initial-request",
            error,
          });
          await this.waitBeforeSameModelRetry(
            decision,
            state,
            error,
            abortSignal,
          );
        }
      }

      // Should never reach here, but just in case
      throw new DyadError(
        `Max attempts (${this.maxAttempts}) exceeded for ${operationName}`,
        DyadErrorKind.Internal,
      );
    } finally {
      this.isRetrying = false;
    }
  }

  async doGenerate(): Promise<any> {
    throw new DyadError(
      "doGenerate is not supported for fallback model",
      DyadErrorKind.External,
    );
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<StreamResult> {
    this.checkAndResetModel();
    const requestId = getRequestId(options);

    return this.retry(
      async (retryState) => {
        const result = await this.getUnderlyingModel().doStream(
          this.optionsForCurrentModel(options),
        );

        return {
          ...result,
          stream: this.createWrappedStream(result.stream, options, retryState),
        };
      },
      "stream",
      requestId,
      options.abortSignal,
    );
  }

  private createWrappedStream(
    originalStream: ReadableStream<LanguageModelV3StreamPart>,
    options: LanguageModelV3CallOptions,
    retryState: RetryState,
  ): ReadableStream<LanguageModelV3StreamPart> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fallbackModel = this;

    return new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        let hasStreamedContent = false;
        let reader: ReadableStreamDefaultReader<LanguageModelV3StreamPart> | null =
          null;

        const processStream = async (
          stream: ReadableStream<LanguageModelV3StreamPart>,
        ): Promise<void> => {
          let attemptHasStreamedContent = false;
          reader = stream.getReader();

          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                controller.close();
                return;
              }

              // Check for early errors before streaming content
              if (!attemptHasStreamedContent && value && "error" in value) {
                const error = value.error;
                const action = getFallbackFailureAction(error);
                if (action !== "fail") {
                  throw error;
                }
                logger.warn(
                  `Stream error event from model ${fallbackModel.modelId}; not retrying or falling back (requestId=${getRequestId(options)}, hasStreamedContent=${hasStreamedContent}, attempt=${retryState.attemptNumber}/${fallbackModel.maxAttempts}, error="${formatFallbackErrorForLog(error)}")`,
                );
              }

              controller.enqueue(value);

              // Mark that we've streamed actual content (not just metadata)
              if (isStreamContentPart(value)) {
                attemptHasStreamedContent = true;
                hasStreamedContent = true;
              }
            }
          } finally {
            reader?.releaseLock();
          }
        };

        let currentStream = originalStream;
        let pendingError: unknown;
        let hasPendingError = false;
        while (true) {
          if (!hasPendingError) {
            try {
              await processStream(currentStream);
              return;
            } catch (error) {
              pendingError = error;
              hasPendingError = true;
            }
          }

          const failedModelId = fallbackModel.modelId;
          retryState.errors.push({
            modelId: failedModelId,
            error: pendingError,
          });
          const action = getFallbackFailureAction(pendingError);
          if (action === "fail" || hasStreamedContent) {
            logger.warn(
              `Stream error from model ${failedModelId}; not retrying or falling back (requestId=${getRequestId(options)}, hasStreamedContent=${hasStreamedContent}, attempt=${retryState.attemptNumber}/${fallbackModel.maxAttempts}, error="${formatFallbackErrorForLog(pendingError)}")`,
            );
            controller.error(pendingError);
            return;
          }

          const decision = fallbackModel.prepareRecovery(action, retryState);
          if (
            !decision ||
            retryState.attemptNumber >= fallbackModel.maxAttempts
          ) {
            logger.error(
              `All ${fallbackModel.settings.models.length} models exhausted during streaming after ${retryState.attemptNumber} attempts (requestId=${getRequestId(options)}, error="${formatFallbackErrorForLog(pendingError)}")`,
            );
            controller.error(
              fallbackModel.exhaustedError("streaming", pendingError),
            );
            return;
          }

          fallbackModel.logRecovery({
            decision,
            state: retryState,
            requestId: getRequestId(options),
            stage: "stream",
            error: pendingError,
            hasStreamedContent,
          });
          await fallbackModel.waitBeforeSameModelRetry(
            decision,
            retryState,
            pendingError,
            options.abortSignal,
          );
          throwIfAborted(options.abortSignal);
          fallbackModel.startAttempt(retryState);

          try {
            const nextResult = await fallbackModel
              .getUnderlyingModel()
              .doStream(fallbackModel.optionsForCurrentModel(options));
            currentStream = nextResult.stream;
            pendingError = undefined;
            hasPendingError = false;
          } catch (error) {
            pendingError = error;
            hasPendingError = true;
          }
        }
      },

      cancel() {
        // Handle stream cancellation if needed
      },
    });
  }
}

// Export utility functions
export { defaultShouldRetryThisError as isRetryableError };

export function isRateLimitError(error: any): boolean {
  const statusCode = error?.statusCode || error?.status;
  return (
    statusCode === 429 ||
    (error?.message && error.message.toLowerCase().includes("rate"))
  );
}
