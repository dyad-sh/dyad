import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function OauthPlaintextStorageAlert() {
  return (
    <Alert variant="destructive">
      <AlertTitle>
        OAuth tokens and client secrets stored without OS encryption
      </AlertTitle>
      <AlertDescription>
        Your OS keyring is unavailable (on Linux this usually means
        <code className="mx-1">libsecret</code>/<code>gnome-keyring</code>
        is not installed), so OAuth tokens and pre-registered client secrets for
        HTTP MCP servers are written to the local database without encryption.
        Any process with read access to the Dyad data directory can decode them.
        Client secrets are especially sensitive because they don't expire.
        Install a keyring service and reconnect (and re-enter any pre-registered
        client secret) to upgrade.
      </AlertDescription>
    </Alert>
  );
}
