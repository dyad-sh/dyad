import { hasDyadProKey, type UserSettings } from "@/lib/schemas";

type TelemetryProperties = Record<string, unknown> | undefined;

export type InitialLoadTelemetryInput = {
  settings: UserSettings;
  appVersion: string;
  platform: string | null;
  isFirstSession: boolean;
};

export function getInitialLoadTelemetryProperties({
  settings,
  appVersion,
  platform,
  isFirstSession,
}: InitialLoadTelemetryInput) {
  return {
    isPro: hasDyadProKey(settings),
    appVersion,
    platform,
    releaseChannel: settings.releaseChannel,
    isFirstSession,
    modelProvider: settings.selectedModel.provider,
    defaultChatMode: settings.defaultChatMode ?? null,
    runtimeMode2: settings.runtimeMode2 ?? "host",
  };
}

/** PostHog event shape used by renderer `before_send` sampling. */
export type PostHogTelemetryEvent = {
  event?: string;
  properties?: TelemetryProperties;
};

/**
 * Non-Pro telemetry sends only ~10% of events. These events are always sent.
 * Keep `sandbox.script.*` here so script instrumentation is never sampled out.
 */
/** Node/Electron undici network failure with no actionable stack context. */
export function isGenericFetchFailedError(
  name: string | undefined,
  message: string | undefined,
): boolean {
  return name === "TypeError" && message === "fetch failed";
}

export function shouldFilterPostHogExceptionEvent(
  event: PostHogTelemetryEvent | null | undefined,
): boolean {
  const properties = event?.properties;
  if (!properties) {
    return false;
  }

  if (
    isGenericFetchFailedError(
      typeof properties.exception_name === "string"
        ? properties.exception_name
        : undefined,
      typeof properties.exception_message === "string"
        ? properties.exception_message
        : undefined,
    )
  ) {
    return true;
  }

  return isGenericFetchFailedError(
    typeof properties.$exception_type === "string"
      ? properties.$exception_type
      : undefined,
    typeof properties.$exception_message === "string"
      ? properties.$exception_message
      : undefined,
  );
}

export function shouldBypassNonProTelemetrySampling(
  event: PostHogTelemetryEvent | null | undefined,
): boolean {
  const eventName = event?.event;
  const properties = event?.properties;

  if (eventName?.startsWith("sandbox.script.")) {
    return true;
  }

  if (eventName === "app:initial-load") {
    return true;
  }

  return (
    eventName === "$exception" ||
    eventName?.toLowerCase().includes("error") === true ||
    !!properties?.$exception_type ||
    !!properties?.error
  );
}

export function createExceptionFromTelemetry(properties: TelemetryProperties) {
  const exception = new Error(
    typeof properties?.exception_message === "string"
      ? properties.exception_message
      : "Unknown IPC exception",
  );

  if (typeof properties?.exception_name === "string") {
    exception.name = properties.exception_name;
  }

  if (typeof properties?.exception_stack_trace === "string") {
    exception.stack = properties.exception_stack_trace;
  }

  return exception;
}

export function getExceptionTelemetryContext(properties: TelemetryProperties) {
  if (!properties) {
    return undefined;
  }

  const {
    exception_name: _exceptionName,
    exception_message: _exceptionMessage,
    exception_stack_trace: _exceptionStackTrace,
    ...context
  } = properties;

  return Object.keys(context).length > 0 ? context : undefined;
}
