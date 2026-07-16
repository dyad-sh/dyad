import { atom, useAtom } from "jotai";
import { useMcp } from "@/hooks/useMcp";
import type { McpServer } from "@/ipc/types";
import { ipc } from "@/ipc/types";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import { useOauthCallbackPort } from "./AddPluginDialog";
import type { ConnectFeedback } from "./PluginSummaryCard";

// Connect state survives navigation between the plugins list and a
// plugin detail page, so a failure raised on one is visible on the
// other and an in-flight flow can't be started twice.
const connectFeedbackAtom = atom<ConnectFeedback | null>(null);
const connectingServerIdAtom = atom<number | null>(null);
const disconnectingServerIdAtom = atom<number | null>(null);

// Shared OAuth connect/probe handling for the plugins list and the
// plugin detail page.
export function usePluginConnect() {
  const { statusByServer, updateServer, startOAuth, disconnectOAuth } =
    useMcp();
  const [connectingServerId, setConnectingServerId] = useAtom(
    connectingServerIdAtom,
  );
  const [disconnectingServerId, setDisconnectingServerId] = useAtom(
    disconnectingServerIdAtom,
  );
  const [connectFeedback, setConnectFeedback] = useAtom(connectFeedbackAtom);

  const callbackPort = useOauthCallbackPort();

  // Sole owner of the shared connect slot: claims it for the duration
  // of `fn`. Buttons that start a connect flow disable while the slot
  // is held, so only one flow can run at a time.
  const withConnectSlot = async (serverId: number, fn: () => Promise<void>) => {
    setConnectingServerId(serverId);
    try {
      await fn();
    } finally {
      setConnectingServerId(null);
    }
  };

  // The OAuth flow itself; callers hold the connect slot.
  const autoConnect = async (
    serverId: number,
    opts?: { showToast?: boolean; callbackPort?: number },
  ) => {
    // Clear any prior feedback so a stale "discovery_failed" alert
    // can't sit next to a fresh error toast on the retry path.
    setConnectFeedback(null);
    // No port means the flow uses the server's saved port, which
    // matches its registered redirect URI. Callers pass the probed
    // port only for rows with none saved yet.
    const result = await startOAuth({
      serverId,
      callbackPort: opts?.callbackPort,
    });
    if (result.success) {
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
  };

  const runAutoConnect = async (
    serverId: number,
    opts?: { showToast?: boolean; callbackPort?: number },
  ) => withConnectSlot(serverId, () => autoConnect(serverId, opts));

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

  // The retry handlers' slot claim covers the settings update as well
  // as the connect attempt: the update awaits query invalidation,
  // which can take seconds, and a second click in that window would
  // start a duplicate OAuth flow or probe. `isUpdatingServer` can't
  // guard this; mutation state is local to each useMcp() instance.
  const onEnableOAuthAndRetry = async (serverId: number) =>
    withConnectSlot(serverId, async () => {
      await updateServer({ id: serverId, oauthEnabled: true });
      setConnectFeedback(null);
      // Just enabled, so no saved port yet -- use the probed one.
      await autoConnect(serverId, {
        callbackPort:
          typeof callbackPort === "number" ? callbackPort : undefined,
      });
    });

  const onDisableOAuthAndRetry = async (serverId: number) =>
    withConnectSlot(serverId, async () => {
      await updateServer({ id: serverId, oauthEnabled: false });
      setConnectFeedback(null);
      await runProbe(serverId);
    });

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

  // An OAuth-off server that returns 401 needs auth; surface that from
  // the live probe status so the alert stays put.
  const feedbackFor = (server: McpServer): ConnectFeedback | null => {
    if (connectFeedback && connectFeedback.serverId === server.id) {
      return connectFeedback;
    }
    if (!server.oauthEnabled && statusByServer[server.id] === "unauthorized") {
      return {
        serverId: server.id,
        kind: "unauthorized",
        message:
          "This server requires authentication. Enable OAuth and try again.",
      };
    }
    return null;
  };

  return {
    connectingServerId,
    disconnectingServerId,
    feedbackFor,
    onServerCreated,
    onConnect,
    onDisconnect,
    onEnableOAuthAndRetry,
    onDisableOAuthAndRetry,
  } as const;
}
