import {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider";

// Types
interface FallbackSettings {
  models: Array<LanguageModelV2>;
}

interface RetryState {
  attemptNumber: number;
  modelsAttempted: Set<number>;
  initialModelIndex: number;
  errors: Array<{ modelId: string; error: Error }>;
}

interface StreamResult {
  stream: ReadableStream<LanguageModelV2StreamPart>;
  request?: { body?: unknown };
  response?: { headers?: Record<string, string> };
}

// Error classification
const RETRYABLE_STATUS_CODES = new Set([
  401, // Unauthorized - wrong API key
  403, // Forbidden - permission error
  408, // Request Timeout
  409, // Conflict
  413, // Payload Too Large
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

const RETRYABLE_ERROR_PATTERNS = [
  "overloaded",
  "service unavailable",
  "bad gateway",
  "too many requests",
  "internal server error",
  "gateway timeout",
  "rate_limit",
  "wrong-key",
  "unexpected",
  "capacity",
  "timeout",
  "server_error",
  "econnrefused",
  "enotfound",
  "econnreset",
  "epipe",
  "etimedout",
];

export function defaultShouldRetryThisError(error: any): boolean {
  if (!error) return false;

  try {
    // Check status code
    const statusCode =
      error?.statusCode || error?.status || error?.response?.status;
    if (
      statusCode &&
      (RETRYABLE_STATUS_CODES.has(statusCode) || statusCode >= 500)
    ) {
      return true;
    }

    // Check error message patterns
    const errorString = (
      error?.message ||
      error?.code ||
      error?.type ||
      JSON.stringify(error)
    ).toLowerCase();

    return RETRYABLE_ERROR_PATTERNS.some((pattern) =>
      errorString.includes(pattern),
    );
  } catch {
    // If we can't parse the error, don't retry
    return false;
  }
}

export function createFallback(settings: FallbackSettings): FallbackModel {
  return new FallbackModel(settings);
}

export class FallbackModel implements LanguageModelV2 {
  readonly specificationVersion = "v2";
  private readonly settings: FallbackSettings;
  private currentModelIndex: number = 0;
  private lastModelReset: number = Date.now();
  private readonly modelResetInterval: number;
  private readonly retryAfterOutput: boolean;
  private readonly maxRetries: number;
  private isRetrying: boolean = false;

  constructor(settings: FallbackSettings) {
    // Validate settings
    if (!settings.models || settings.models.length === 0) {
      throw new Error("At least one model must be provided in settings.models");
    }

    this.settings = settings;
    this.modelResetInterval = 3 * 60 * 1000; // Default: 3 minutes
    this.retryAfterOutput = true;
    this.maxRetries = settings.models.length * 2; // Default: try each model twice
  }

  get modelId(): string {
    return this.getCurrentModel().modelId;
  }

  get provider(): string {
    return this.getCurrentModel().provider;
  }

  get supportedUrls():
    | Record<string, RegExp[]>
    | PromiseLike<Record<string, RegExp[]>> {
    return this.getCurrentModel().supportedUrls;
  }

  private getCurrentModel(): LanguageModelV2 {
    const model = this.settings.models[this.currentModelIndex];
    if (!model) {
      throw new Error(`Model at index ${this.currentModelIndex} not found`);
    }
    return model;
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

  private switchToNextModel(): void {
    this.currentModelIndex =
      (this.currentModelIndex + 1) % this.settings.models.length;
  }

  private async retry<T>(
    operation: (state: RetryState) => Promise<T>,
    operationName: string,
  ): Promise<T> {
    const state: RetryState = {
      attemptNumber: 0,
      modelsAttempted: new Set([this.currentModelIndex]),
      initialModelIndex: this.currentModelIndex,
      errors: [],
    };

    this.isRetrying = true;

    try {
      while (state.attemptNumber < this.maxRetries) {
        state.attemptNumber++;

        try {
          return await operation(state);
        } catch (error) {
          const err = error as Error;
          state.errors.push({ modelId: this.modelId, error: err });

          // Check if we should retry this error
          if (!defaultShouldRetryThisError(err)) {
            throw err;
          }

          // Call error handler if provided

          // If we've tried all models at least once and still failing, throw
          if (state.modelsAttempted.size === this.settings.models.length) {
            // If we haven't hit max retries yet, we can try models again
            if (state.attemptNumber >= this.maxRetries) {
              throw new Error(
                `All ${this.settings.models.length} models failed for ${operationName}. ` +
                  `Last error: ${err.message}`,
              );
            }
          }

          // Switch to next model
          this.switchToNextModel();
          state.modelsAttempted.add(this.currentModelIndex);
        }
      }

      // Should never reach here, but just in case
      throw new Error(
        `Max retries (${this.maxRetries}) exceeded for ${operationName}`,
      );
    } finally {
      this.isRetrying = false;
    }
  }

  async doGenerate(): Promise<any> {
    throw new Error("doGenerate is not supported for fallback model");
  }

  async doStream(options: LanguageModelV2CallOptions): Promise<StreamResult> {
    this.checkAndResetModel();

    return this.retry(async (retryState) => {
      const result = await this.getCurrentModel().doStream(options);

      // Create a wrapped stream that handles errors gracefully
      const wrappedStream = this.createWrappedStream(
        result.stream,
        options,
        retryState,
      );

      return {
        ...result,
        stream: wrappedStream,
      };
    }, "stream");
  }

  private createWrappedStream(
    originalStream: ReadableStream<LanguageModelV2StreamPart>,
    options: LanguageModelV2CallOptions,
    retryState: RetryState,
  ): ReadableStream<LanguageModelV2StreamPart> {
    let hasStreamedContent = false;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fallbackModel = this;

    return new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        let reader: ReadableStreamDefaultReader<LanguageModelV2StreamPart> | null =
          null;

        const processStream = async (
          stream: ReadableStream<LanguageModelV2StreamPart>,
        ): Promise<void> => {
          reader = stream.getReader();

          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                controller.close();
                return;
              }

              // Check for early errors before streaming content
              if (!hasStreamedContent && value && "error" in value) {
                const error = value.error as Error;
                if (defaultShouldRetryThisError(error)) {
                  throw error;
                }
              }

              controller.enqueue(value);

              // Mark that we've streamed actual content (not just metadata)
              if (value?.type && value.type !== "stream-start") {
                hasStreamedContent = true;
              }
            }
          } finally {
            reader?.releaseLock();
          }
        };

        try {
          await processStream(originalStream);
        } catch (error) {
          const err = error as Error;

          // Decide whether to retry
          const shouldRetry =
            (!hasStreamedContent || fallbackModel.retryAfterOutput) &&
            defaultShouldRetryThisError(err) &&
            retryState.attemptNumber < fallbackModel.maxRetries;

          if (shouldRetry) {
            // Track this error
            retryState.errors.push({
              modelId: fallbackModel.modelId,
              error: err,
            });
            retryState.attemptNumber++;

            // Switch to next model
            fallbackModel.switchToNextModel();
            retryState.modelsAttempted.add(fallbackModel.currentModelIndex);

            // Check if we've tried all models
            if (
              retryState.modelsAttempted.size ===
                fallbackModel.settings.models.length &&
              retryState.attemptNumber >= fallbackModel.maxRetries
            ) {
              controller.error(
                new Error(
                  `All models failed during streaming. Last error: ${err.message}`,
                ),
              );
              return;
            }

            try {
              // Create a new stream with the next model
              const nextResult = await fallbackModel
                .getCurrentModel()
                .doStream(options);
              await processStream(nextResult.stream);
            } catch (nextError) {
              // If the retry also fails, propagate the error
              controller.error(nextError);
            }
          } else {
            // Don't retry - propagate the error
            controller.error(err);
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

// Type guards for better error handling
export function isNetworkError(error: any): boolean {
  const networkErrorCodes = [
    "ECONNREFUSED",
    "ENOTFOUND",
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
  ];
  return error?.code && networkErrorCodes.includes(error.code);
}

export function isRateLimitError(error: any): boolean {
  const statusCode = error?.statusCode || error?.status;
  return (
    statusCode === 429 ||
    (error?.message && error.message.toLowerCase().includes("rate"))
  );
}
