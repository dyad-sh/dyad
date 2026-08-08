type ProviderResponseError = {
  message?: unknown;
  responseBody?: unknown;
  responseHeaders?: unknown;
};

function responseContentType(headers: unknown) {
  if (!headers || typeof headers !== "object") return "";
  const record = headers as Record<string, unknown>;
  const value = record["content-type"] ?? record["Content-Type"];
  return typeof value === "string" ? value : "";
}

export function isSseInvalidJsonResponse(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const providerError = error as ProviderResponseError;
  if (providerError.message !== "Invalid JSON response") return false;

  const contentType = responseContentType(providerError.responseHeaders);
  const body =
    typeof providerError.responseBody === "string"
      ? providerError.responseBody.trimStart()
      : "";
  return contentType.includes("text/event-stream") || body.startsWith("data:");
}

export function providerResponseErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") return {};
  const providerError = error as ProviderResponseError & {
    statusCode?: unknown;
  };
  return {
    status:
      typeof providerError.statusCode === "number"
        ? providerError.statusCode
        : undefined,
    contentType: responseContentType(providerError.responseHeaders),
    body:
      typeof providerError.responseBody === "string"
        ? providerError.responseBody.slice(0, 2_000)
        : undefined,
  };
}
