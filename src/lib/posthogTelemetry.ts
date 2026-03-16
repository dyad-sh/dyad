type TelemetryProperties = Record<string, unknown> | undefined;

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
