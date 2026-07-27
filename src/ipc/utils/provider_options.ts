// Header used to correlate provider requests with a Dyad chat turn.
export const DYAD_INTERNAL_REQUEST_ID_HEADER =
  "x-dyad-internal-request-id" as const;

export interface GetAiHeadersParams {
  builtinProviderId: string | undefined;
}

export function getAiHeaders(
  _params: GetAiHeadersParams,
): Record<string, string> | undefined {
  return undefined;
}
