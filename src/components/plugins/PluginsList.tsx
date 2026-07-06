import React, { useMemo, useState } from "react";
import { useMcp } from "@/hooks/useMcp";
import type { McpServer, McpToolConsent } from "@/ipc/types";
import { ipc } from "@/ipc/types";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import {
  AddPluginDialog,
  useOauthCallbackPort,
  useOauthStorageEncrypted,
} from "./AddPluginDialog";
import { OauthPlaintextStorageAlert } from "./OauthPlaintextStorageAlert";
import { PluginCard, type ConnectFeedback } from "./PluginCard";

export function PluginsList({
  addDialogOpen,
  onAddDialogOpenChange,
}: {
  addDialogOpen: boolean;
  onAddDialogOpenChange: (open: boolean) => void;
}) {
  const {
    servers,
    toolsByServer,
    statusByServer,
    consentsMap,
    toggleEnabled: toggleServerEnabled,
    deleteServer,
    setToolConsent: updateToolConsent,
    updateServer,
    isUpdatingServer,
    startOAuth,
    disconnectOAuth,
    isStartingOAuth,
    isDisconnectingOAuth,
  } = useMcp();
  const [consents, setConsents] = useState<
    Record<string, McpToolConsent["consent"]>
  >({});
  const [connectingServerId, setConnectingServerId] = useState<number | null>(
    null,
  );
  const [disconnectingServerId, setDisconnectingServerId] = useState<
    number | null
  >(null);
  const [connectFeedback, setConnectFeedback] =
    useState<ConnectFeedback | null>(null);

  const callbackPort = useOauthCallbackPort();
  const oauthStorageEncrypted = useOauthStorageEncrypted();

  React.useEffect(() => {
    setConsents(consentsMap);
  }, [consentsMap]);

  const runAutoConnect = async (
    serverId: number,
    opts?: { showToast?: boolean; callbackPort?: number },
  ) => {
    // Clear any prior feedback so a stale "discovery_failed" alert
    // can't sit next to a fresh error toast on the retry path.
    setConnectFeedback(null);
    setConnectingServerId(serverId);
    try {
      // No port means the flow uses the server's saved port, which
      // matches its registered redirect URI. Callers pass the probed
      // port only for rows with none saved yet.
      const result = await startOAuth({
        serverId,
        callbackPort: opts?.callbackPort,
      });
      if (result.success) {
        setConnectFeedback(null);
        showSuccess("OAuth connection successful");
        return;
      }
      const message = result.error ?? "OAuth flow failed";
      if (result.errorKind === "discovery_failed") {
        setConnectFeedback({
          serverId,
          kind: "discovery_failed",
          message,
        });
        // Toast only on the initial post-registration attempt so the
        // failure is visible even when the new row is scrolled out of
        // view. Manual retries show the inline panel in place.
        if (opts?.showToast) {
          showError(
            "OAuth connection failed. This server doesn't support OAuth.",
          );
        }
      } else {
        showError(message);
      }
    } finally {
      setConnectingServerId(null);
    }
  };

  const runProbe = async (serverId: number, opts?: { showToast?: boolean }) => {
    try {
      const result = await ipc.mcp.probeConnection(serverId);
      if (result.status === "unauthorized") {
        setConnectFeedback({
          serverId,
          kind: "unauthorized",
          message:
            "This server requires authentication. Enable OAuth and try again.",
        });
        if (opts?.showToast) {
          showError(
            "Server connection failed. This server requires authentication. Try enabling OAuth.",
          );
        }
      } else {
        setConnectFeedback(null);
      }
    } catch {
      // Best-effort probe; swallow on failure.
    }
  };

  const onServerCreated = async (
    created: McpServer,
    opts: { wantsOAuth: boolean; callbackPort: number | null },
  ) => {
    if (opts.wantsOAuth) {
      // Bridge the gap until the new row arrives in `serversQuery`
      // and shows its own "Connecting…" state.
      showInfo(`Connecting OAuth for "${created.name}"…`);
      await runAutoConnect(created.id, {
        showToast: true,
        callbackPort:
          typeof opts.callbackPort === "number" ? opts.callbackPort : undefined,
      });
    } else {
      await runProbe(created.id, { showToast: true });
    }
  };

  const onConnect = async (serverId: number) => {
    await runAutoConnect(serverId);
  };

  const onEnableOAuthAndRetry = async (serverId: number) => {
    await updateServer({ id: serverId, oauthEnabled: true });
    setConnectFeedback(null);
    // Just enabled, so no saved port yet -- use the probed one.
    await runAutoConnect(serverId, {
      callbackPort: typeof callbackPort === "number" ? callbackPort : undefined,
    });
  };

  const onDisableOAuthAndRetry = async (serverId: number) => {
    await updateServer({ id: serverId, oauthEnabled: false });
    setConnectFeedback(null);
    await runProbe(serverId);
  };

  const onDisconnect = async (serverId: number) => {
    setDisconnectingServerId(serverId);
    try {
      await disconnectOAuth(serverId);
      showSuccess("Disconnected OAuth");
    } catch (err) {
      showError(
        err instanceof Error ? err.message : "Failed to disconnect OAuth",
      );
    } finally {
      setDisconnectingServerId(null);
    }
  };

  const onSetToolConsent = async (
    serverId: number,
    toolName: string,
    consent: McpToolConsent["consent"],
  ) => {
    await updateToolConsent(serverId, toolName, consent);
    setConsents((prev) => ({ ...prev, [`${serverId}:${toolName}`]: consent }));
  };

  const hasOauthServer = useMemo(
    () => (servers || []).some((s) => s.transport === "http" && s.oauthEnabled),
    [servers],
  );
  const showPlaintextBanner = oauthStorageEncrypted === false && hasOauthServer;

  return (
    <div className="space-y-6">
      {showPlaintextBanner && <OauthPlaintextStorageAlert />}
      <div className="space-y-3">
        {servers.map((s) => {
          // An OAuth-off server that returns 401 needs auth; surface
          // that from the live probe status so the alert stays put.
          const feedback: ConnectFeedback | null =
            connectFeedback && connectFeedback.serverId === s.id
              ? connectFeedback
              : !s.oauthEnabled && statusByServer[s.id] === "unauthorized"
                ? {
                    serverId: s.id,
                    kind: "unauthorized",
                    message:
                      "This server requires authentication. Enable OAuth and try again.",
                  }
                : null;
          return (
            <PluginCard
              key={s.id}
              server={s}
              tools={toolsByServer[s.id] || []}
              consents={consents}
              feedback={feedback}
              isConnecting={isStartingOAuth && connectingServerId === s.id}
              isDisconnecting={
                isDisconnectingOAuth && disconnectingServerId === s.id
              }
              isStartingOAuth={isStartingOAuth}
              isUpdatingServer={!!isUpdatingServer}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onToggleEnabled={toggleServerEnabled}
              onDelete={deleteServer}
              onUpdateEnvJson={async (id, envJson) => {
                await updateServer({ id, envJson });
              }}
              onUpdateHeadersJson={async (id, headersJson) => {
                await updateServer({ id, headersJson });
              }}
              onSetToolConsent={onSetToolConsent}
              onEnableOAuthAndRetry={onEnableOAuthAndRetry}
              onDisableOAuthAndRetry={onDisableOAuthAndRetry}
            />
          );
        })}
        {servers.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No plugins added yet.
          </div>
        )}
      </div>
      <AddPluginDialog
        open={addDialogOpen}
        onOpenChange={onAddDialogOpenChange}
        onServerCreated={onServerCreated}
      />
    </div>
  );
}
