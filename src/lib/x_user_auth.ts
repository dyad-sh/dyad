/**
 * Whether an X API failure is plausibly recoverable by rotating the saved
 * OAuth 2.0 user access token. Permission and validation failures deliberately
 * return false because refreshing cannot change scopes or request content.
 */
export function shouldRefreshXUserAuth(
  status: number,
  errorMessage: string,
): boolean {
  return (
    status === 401 ||
    /\b(?:application-only|app-only|user access token|unauthori[sz]ed)\b/i.test(
      errorMessage,
    )
  );
}
