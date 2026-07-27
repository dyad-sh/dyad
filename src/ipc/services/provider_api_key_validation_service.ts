import log from "electron-log";

import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { ProviderApiKeyValidationProvider } from "@/ipc/types";
import { getPiModels, resolveDyadModel } from "@/ipc/pi/model_runtime";
import { buildStreamOptions } from "@/ipc/pi/stream_fn";
import { readEffectiveSettings } from "@/main/settings";
import {
  findInvalidProviderApiKeyCharacter,
  formatInvalidProviderApiKeyMessage,
  normalizeProviderApiKeyInput,
} from "@/lib/providerApiKey";
import type { UserSettings } from "@/lib/schemas";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";

const logger = log.scope("provider_api_key_validation");

const VALIDATION_PROMPT =
  "What number is after four? Reply with only the number.";
const VALIDATION_TIMEOUT_MS = 20_000;

const PROVIDER_DISPLAY_NAMES: Record<ProviderApiKeyValidationProvider, string> =
  {
    google: "Google",
    openrouter: "OpenRouter",
  };

const VALIDATION_MODELS = {
  google: "gemini-flash-latest",
  openrouter: "openrouter/free",
} as const satisfies Record<ProviderApiKeyValidationProvider, string>;

export async function validateProviderApiKey({
  provider,
  apiKey,
}: {
  provider: ProviderApiKeyValidationProvider;
  apiKey: string;
}): Promise<{ ok: true }> {
  const normalizedApiKey = normalizeProviderApiKeyInput(apiKey);
  const providerDisplayName = PROVIDER_DISPLAY_NAMES[provider];

  if (!normalizedApiKey) {
    throw new DyadError("API Key cannot be empty.", DyadErrorKind.Validation);
  }

  const invalidCharacter = findInvalidProviderApiKeyCharacter(normalizedApiKey);
  if (invalidCharacter) {
    throw new DyadError(
      formatInvalidProviderApiKeyMessage(providerDisplayName, invalidCharacter),
      DyadErrorKind.Validation,
    );
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new DyadError(
          `${providerDisplayName} did not respond while checking this API key. Please try again.`,
          DyadErrorKind.External,
        ),
      );
    }, VALIDATION_TIMEOUT_MS);
  });

  try {
    const completionPromise = createValidationCompletion(
      provider,
      normalizedApiKey,
      controller.signal,
    );
    completionPromise.catch(() => {});
    const completion = await Promise.race([completionPromise, timeout]);
    if (
      completion.stopReason === "error" ||
      completion.stopReason === "aborted"
    ) {
      throw new Error(
        completion.errorMessage || `${providerDisplayName} validation failed`,
      );
    }
    return { ok: true };
  } catch (error) {
    throw classifyValidationError(error, providerDisplayName);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function createValidationCompletion(
  provider: ProviderApiKeyValidationProvider,
  apiKey: string,
  signal: AbortSignal,
) {
  const selectedModel = {
    provider,
    name: VALIDATION_MODELS[provider],
  };
  const settings = {
    ...(await readEffectiveSettings()),
    selectedModel,
  } satisfies UserSettings;
  const resolvedModel = await resolveDyadModel(selectedModel);
  const model = {
    ...resolvedModel,
    baseUrl:
      provider === "google"
        ? (getGoogleBaseUrl() ?? resolvedModel.baseUrl)
        : getOpenRouterBaseUrl(),
  };
  const streamOptions = await buildStreamOptions(selectedModel, settings);

  return getPiModels().completeSimple(
    model,
    {
      messages: [
        {
          role: "user",
          content: VALIDATION_PROMPT,
          timestamp: Date.now(),
        },
      ],
    },
    {
      ...streamOptions,
      apiKey,
      maxTokens: 8,
      temperature: 0,
      maxRetries: 0,
      signal,
    },
  );
}

function getGoogleBaseUrl() {
  if (IS_TEST_BUILD && process.env.FAKE_LLM_PORT) {
    return `http://localhost:${process.env.FAKE_LLM_PORT}/google/v1beta`;
  }
  return undefined;
}

function getOpenRouterBaseUrl() {
  if (IS_TEST_BUILD && process.env.FAKE_LLM_PORT) {
    return `http://localhost:${process.env.FAKE_LLM_PORT}/openrouter/v1`;
  }
  return "https://openrouter.ai/api/v1";
}

function classifyValidationError(
  error: unknown,
  providerDisplayName: string,
): DyadError {
  if (isDyadError(error)) {
    return error;
  }

  const errorMessage = extractErrorMessage(error);
  const statusCode =
    extractStatusCode(error) ?? extractStatusCodeFromMessage(errorMessage);

  logger.info(
    `Validation failed for ${providerDisplayName}: status=${statusCode ?? "unknown"} authError=${isAuthError(errorMessage)}`,
  );

  if (statusCode === 401 || statusCode === 403 || isAuthError(errorMessage)) {
    return new DyadError(
      `${providerDisplayName} rejected this API key. Try another API key or keep this one anyway.`,
      DyadErrorKind.Auth,
    );
  }

  if (
    statusCode === 429 ||
    /rate.?limit|too many requests/i.test(errorMessage)
  ) {
    return new DyadError(
      `${providerDisplayName} rate limited the API key check. You can try again later or keep this key anyway.`,
      DyadErrorKind.RateLimited,
    );
  }

  return new DyadError(
    `Dyad could not verify this ${providerDisplayName} API key: ${errorMessage || "Unknown error"}`,
    DyadErrorKind.External,
  );
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function extractStatusCode(error: unknown, depth = 0): number | undefined {
  if (depth > 5 || typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  const status =
    candidate.statusCode ?? candidate.status ?? candidate.response?.status;
  if (typeof status === "number") {
    return status;
  }
  return extractStatusCode(candidate.cause, depth + 1);
}

// Stream error events from OpenAI-compatible proxies are plain
// strings that lead with the upstream status code, like
// "401 LiteLLM Virtual Key expected. ...".
function extractStatusCodeFromMessage(message: string): number | undefined {
  const match = /^\s*([45]\d{2})\b/.exec(message);
  return match ? Number(match[1]) : undefined;
}

function isAuthError(message: string) {
  return /api key|unauthorized|unauthenticated|invalid.?key|permission denied|forbidden/i.test(
    message,
  );
}
