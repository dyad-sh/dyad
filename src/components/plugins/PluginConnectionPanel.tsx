import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mcpConsentKey, useMcp } from "@/hooks/useMcp";
import { mcpConnectionKey } from "@/shared/mcp_connection_ref";
import type { McpConnectionConfig, McpToolConsent } from "@/ipc/types";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import { useOauthStorageEncrypted } from "./AddPluginDialog";
import { OauthPlaintextStorageAlert } from "./OauthPlaintextStorageAlert";
import { KeyValueEditor, arrayToJsonObject } from "./KeyValueEditor";
import { PluginSetupSection } from "./PluginSetupSection";
import { connectionSetupState, unfilledOptionalInputs } from "./pluginSetup";
import { usePluginConnect, type ConnectFeedback } from "./usePluginConnect";

// Keyed on the full kind union so adding a feedback kind forces a
// title here instead of silently reusing another kind's.
const FEEDBACK_TITLES: Record<ConnectFeedback["kind"], string> = {
  unauthorized: "Server requires authentication",
  discovery_failed: "Server doesn't support OAuth",
  credentials: "Authentication failed",
};

// Shown in place of an editable list when the stored values can't be
// decrypted. Editing is locked because the list would render empty and
// saving it would overwrite the real values.
function UnreadableSecretsNotice() {
  return (
    <Alert variant="destructive" className="mb-3">
      <AlertTitle>Saved values can't be read</AlertTitle>
      <AlertDescription>
        These values are stored encrypted and could not be decrypted, usually
        because the OS keyring is unavailable. Editing is disabled so the saved
        values aren't overwritten. Restore the keyring and reopen this page, or
        delete and re-add the plugin to enter them again.
      </AlertDescription>
    </Alert>
  );
}

/** OAuth status pill for one configuration. */
export function PluginOAuthBadge({
  connection: s,
}: {
  connection: McpConnectionConfig;
}) {
  if (!s.oauthEnabled) return null;
  return (
    <span
      className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${
        s.oauthConnected
          ? "text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-300 border border-green-500/50"
          : "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-500/50"
      }`}
    >
      OAuth:{" "}
      {s.oauthUnreadable
        ? "saved credentials unavailable"
        : s.oauthConnected
          ? "connected"
          : "not connected"}
    </span>
  );
}

/** Connect / Disconnect / Reset OAuth for one configuration. */
export function PluginOAuthButtons({
  connection: s,
  setupIncomplete,
}: {
  connection: McpConnectionConfig;
  setupIncomplete: boolean;
}) {
  const { connectingKey, disconnectingKey, onConnect, onDisconnect } =
    usePluginConnect();
  const key = mcpConnectionKey(s.connection);
  return (
    <>
      {s.oauthEnabled &&
        !s.oauthConnected &&
        !s.oauthUnreadable &&
        !setupIncomplete && (
          // Only one OAuth flow can run at a time (shared connect slot), so
          // Connect is blocked while any server is connecting; the label
          // only spins for this server's own flow.
          <Button
            variant="default"
            onClick={() => onConnect(s.connection)}
            disabled={connectingKey !== null}
          >
            {connectingKey === key ? "Connecting…" : "Connect"}
          </Button>
        )}
      {s.oauthEnabled &&
        (s.oauthUnreadable || (s.oauthConnected && !setupIncomplete)) && (
          <Button
            variant="outline"
            onClick={() => onDisconnect(s.connection)}
            disabled={disconnectingKey === key}
          >
            {disconnectingKey === key
              ? "Disconnecting…"
              : s.oauthUnreadable
                ? "Reset OAuth"
                : "Disconnect"}
          </Button>
        )}
    </>
  );
}

/**
 * Everything below a configuration's header: connection feedback, catalog
 * setup, env/header editors and the tool list with its approvals. Used for
 * a plugin's default configuration and for each app-specific one.
 */
export function PluginConnectionPanel({
  connection: s,
  catalogEntry,
  catalogIsLoading,
}: {
  connection: McpConnectionConfig;
  catalogEntry: McpCatalogEntry | undefined;
  catalogIsLoading: boolean;
}) {
  const {
    toolsByServer,
    statusByServer,
    errorByServer,
    consentsMap,
    setToolConsent: updateToolConsent,
    updateConnection,
    isUpdatingServer,
  } = useMcp();
  const key = mcpConnectionKey(s.connection);
  const {
    connectingKey,
    feedbackFor,
    onConnect,
    onEnableOAuthAndRetry,
    onDisableOAuthAndRetry,
  } = usePluginConnect();

  // The plugins list only warns once a server already holds a secret,
  // so the warning has to appear here too: this is where the first one
  // gets entered.
  const oauthStorageEncrypted = useOauthStorageEncrypted();

  // Only successful discovery lands in toolsByServer, so an absent
  // entry means pending or failed, not an empty server.
  const discoveredTools = toolsByServer[key];
  const tools = discoveredTools ?? [];
  const feedback = feedbackFor(s);

  const { setupInputs, needsSetup, setupPending, setupIncomplete } =
    connectionSetupState(s, catalogEntry, catalogIsLoading);
  // Setup rebuilds a map from the stored values before writing it, so
  // it is only unsafe for a map it will actually touch. An entry with
  // OAuth-only inputs writes neither.
  const setupBlockedByUnreadable =
    (s.headersUnreadable && setupInputs.some((i) => i.kind === "header")) ||
    (s.envUnreadable && setupInputs.some((i) => i.kind === "env"));
  // Setup is where a catalog plugin's first credential gets typed, so
  // it needs the same no-keyring warning the editors carry. Saving an
  // OAuth server also starts its connect flow, which stores tokens, so
  // that counts even when the form only asks for a public client id.
  const setupPersistsSecret =
    s.oauthEnabled ||
    setupInputs.some(
      (i) =>
        i.kind === "header" ||
        i.kind === "env" ||
        i.kind === "oauthClientSecret",
    );
  // Optional inputs left blank during setup stay offered by their catalog
  // label, so filling one later doesn't require knowing its variable or
  // header name. Blocked like setup when the map it writes can't be read.
  const optionalInputs = setupIncomplete
    ? []
    : unfilledOptionalInputs(s, setupInputs);
  const optionalBlockedByUnreadable =
    (s.headersUnreadable && optionalInputs.some((i) => i.kind === "header")) ||
    (s.envUnreadable && optionalInputs.some((i) => i.kind === "env"));

  const onSetToolConsent = async (
    toolName: string,
    consent: McpToolConsent["consent"],
  ) => {
    await updateToolConsent(s.connection, toolName, consent);
  };

  return (
    <>
      {feedback && !setupIncomplete && (
        <div className="mt-4">
          <Alert variant="destructive">
            <AlertTitle>{FEEDBACK_TITLES[feedback.kind]}</AlertTitle>
            <AlertDescription className="gap-2">
              <span>{feedback.message}</span>
              {feedback.kind === "unauthorized" && (
                <Button
                  size="sm"
                  onClick={() => onEnableOAuthAndRetry(s.connection)}
                  disabled={isUpdatingServer || connectingKey !== null}
                >
                  Enable OAuth & retry
                </Button>
              )}
              {feedback.kind === "discovery_failed" && (
                <Button
                  size="sm"
                  onClick={() => onDisableOAuthAndRetry(s.connection)}
                  disabled={isUpdatingServer || connectingKey !== null}
                >
                  Disable OAuth & retry
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Setup builds its update from the stored maps, which read
          as empty while a secret can't be decrypted. Saving would
          drop every value the entry doesn't declare, so show the
          notice instead of the form. */}
      {needsSetup && setupBlockedByUnreadable && <UnreadableSecretsNotice />}

      {needsSetup &&
        !setupBlockedByUnreadable &&
        setupPersistsSecret &&
        oauthStorageEncrypted === false && <OauthPlaintextStorageAlert />}

      {needsSetup && !setupBlockedByUnreadable && (
        // Keyed by server so switching between two setup-needing
        // servers starts each from its own blank fields, never
        // carrying one server's typed credentials into another.
        <PluginSetupSection
          key={key}
          server={s}
          inputs={setupInputs}
          isSaving={isUpdatingServer}
          onSave={async (update) => {
            await updateConnection(s.connection, update);
            // An OAuth server goes straight into its connect flow
            // after setup, like the one-click add; key-based servers
            // just enable and discover.
            if (s.oauthEnabled) void onConnect(s.connection);
          }}
        />
      )}

      {setupPending && (
        <div className="mt-4 text-sm text-muted-foreground">Loading setup…</div>
      )}

      {!setupIncomplete && s.transport === "stdio" && (
        <div className="mt-6">
          <div className="text-sm font-medium mb-2">Environment Variables</div>
          {oauthStorageEncrypted === false && <OauthPlaintextStorageAlert />}
          {s.envUnreadable && <UnreadableSecretsNotice />}
          <KeyValueEditor
            id={key}
            json={s.envJson}
            disabled={!s.enabled || s.envUnreadable}
            isSaving={isUpdatingServer}
            onSave={async (pairs) => {
              await updateConnection(s.connection, {
                envJson: arrayToJsonObject(pairs),
              });
            }}
          />
        </div>
      )}
      {!setupIncomplete && s.transport === "http" && (
        <div className="mt-6">
          <div className="text-sm font-medium mb-2">Headers</div>
          {oauthStorageEncrypted === false && <OauthPlaintextStorageAlert />}
          {s.headersUnreadable && <UnreadableSecretsNotice />}
          <KeyValueEditor
            id={key}
            json={s.headersJson}
            disabled={!s.enabled || s.headersUnreadable}
            isSaving={isUpdatingServer}
            itemLabel="Header"
            onSave={async (pairs) => {
              await updateConnection(s.connection, {
                headersJson: arrayToJsonObject(pairs),
              });
            }}
          />
        </div>
      )}

      {optionalInputs.length > 0 && !optionalBlockedByUnreadable && (
        // Sits under the editor it writes to, so that editor's storage
        // warning covers it too. Locked like the editor while disabled.
        <PluginSetupSection
          key={`optional-${key}`}
          variant="optional"
          server={s}
          inputs={optionalInputs}
          disabled={!s.enabled}
          isSaving={isUpdatingServer}
          onSave={async (update) => {
            await updateConnection(s.connection, update);
          }}
        />
      )}

      <div className="mt-6">
        <div className="text-sm font-medium mb-2">Tools</div>
        <div className="space-y-2">
          {tools.map((t) => (
            <div key={t.name} className="border rounded p-2">
              <div className="flex items-center gap-4">
                <div className="font-mono text-sm truncate">{t.name}</div>
                <div className="flex items-center gap-2">
                  <Select
                    value={
                      consentsMap[mcpConsentKey(s.connection, t.name)] || "ask"
                    }
                    onValueChange={(v) => {
                      // The mutation already shows an error toast.
                      onSetToolConsent(
                        t.name,
                        v as McpToolConsent["consent"],
                      ).catch(() => {});
                    }}
                  >
                    <SelectTrigger className="w-[140px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ask">Ask</SelectItem>
                      <SelectItem value="always">Always allow</SelectItem>
                      <SelectItem value="denied">Deny</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {t.description && (
                <div className="mt-1 text-xs max-w-[500px] text-muted-foreground truncate">
                  {t.description}
                </div>
              )}
            </div>
          ))}
          {tools.length === 0 && (
            <div className="text-xs text-muted-foreground">
              {discoveredTools
                ? "No tools discovered."
                : statusByServer[key] === "unauthorized"
                  ? "Tools will be listed once the server is connected."
                  : statusByServer[key] === "error"
                    ? "Tool discovery failed."
                    : "Discovering tools…"}
              {errorByServer[key] && (
                <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                  {errorByServer[key]}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
