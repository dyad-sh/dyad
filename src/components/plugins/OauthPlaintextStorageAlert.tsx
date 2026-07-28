import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function OauthPlaintextStorageAlert() {
  return (
    <Alert variant="destructive">
      <AlertTitle>Plugin credentials stored without OS encryption</AlertTitle>
      <AlertDescription>
        Your OS keyring is unavailable (on Linux this usually means
        <code className="mx-1">libsecret</code>/<code>gnome-keyring</code>
        is not installed), so plugin credentials are written to the local
        database without encryption. That covers OAuth tokens, pre-registered
        client secrets, request headers for HTTP servers, and environment
        variables for command-based servers. Any process with read access to the
        Dyad data directory can decode them. API keys in headers and environment
        variables are especially sensitive because they don't expire. Install a
        keyring service, then reconnect and re-enter those values to upgrade.
      </AlertDescription>
    </Alert>
  );
}
