import { useMemo } from "react";
import { atom, useAtom } from "jotai";
import { useMcp } from "@/hooks/useMcp";
import { useMcpCatalog } from "@/hooks/useMcpCatalog";
import type { McpServer } from "@/ipc/types";
import { ipc } from "@/ipc/types";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import { useOauthCallbackPort } from "./AddPluginDialog";

// Produced by feedbackFor below; the summary card and detail page
// render it as a badge or alert.
export type ConnectFeedback = {
  serverId: number;
  kind: "discovery_failed" | "unauthorized" | "credentials";
  message: string;
};

// Only an OAuth flow outcome is stored: the flow drops its terminal
// state when it settles, so this is the sole copy. Auth status has a
// live owner in `statusByServer` and is read from there.
type StoredConnectFeedback = ConnectFeedback & { kind: "discovery_failed" };

// Connect state survives navigation between the plugins list and a
// plugin detail page, so a failure raised on one is visible on the
// other and an in-flight flow can't be started twice.
const connectFeedbackAtom = atom<StoredConnectFeedback | null>(null);
const connectingServerIdAtom = atom<number | null>(null);
const disconnectingServerIdAtom = atom<number | null>(null);

// Shared OAuth connect/probe handling for the plugins list and the
// plugin detail page.
export function usePluginConnect() {
  const { servers, statusByServer, updateServer, startOAuth, disconnectOAuth } =
    useMcp();
  const [connectingServerId, setConnectingServerId] = useAtom(
    connectingServerIdAtom,
  );
  const [disconnectingServerId, setDisconnectingServerId] = useAtom(
    disconnectingServerIdAtom,
  );
  const [connectFeedback, setConnectFeedback] = useAtom(connectFeedbackAtom);

  const callbackPort = useOauthCallbackPort();

  const catalogQuery = useMcpCatalog();
  // Catalog slugs whose entries authenticate via a user-supplied key, so
  // a 401 means "check the key", not "enable OAuth" -- even before the
  // key has been entered.
  const slugsNeedingKey = useMemo(
    () =>
      new Set(
        (catalogQuery.data?.entries ?? [])
          .filter((e) =>
            (e.inputs ?? []).some(
              (i) => i.kind === "header" || i.kind === "env",
            ),
          )
          .map((e) => e.slug),
      ),
    [catalogQuery.data],
  );

  // Sole owner of the shared connect slot: claims it for the duration
  // of `fn`. Buttons that start a connect flow disable while the slot
  // is held, so only one flow can run at a time.
  const withConnectSlot = async (serverId: number, fn: () => Promise<void>) => {
    setConnectingServerId(serverId);
    try {
      await fn();
    } catch (err) {
      // The mutations inside surface their own error toasts; catching
      // here keeps an unexpected rejection from escaping into the
      // fire-and-forget click handlers. Logged so a non-mutation
      // failure is still visible when debugging.
      console.error("Connect flow failed", err);
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

  // Reports a 401 right after an add, ahead of the tool discovery that
  // the new row triggers. The alert itself comes from that discovery.
  const runProbe = async (serverId: number) => {
    try {
      const result = await ipc.mcp.probeConnection(serverId);
      if (result.status === "unauthorized") {
        showError(
          "Server connection failed. This server requires authentication. Try enabling OAuth.",
        );
      }
    } catch {
      // Best-effort probe; swallow on failure.
    }
  };

  const onServerCreated = async (
    created: McpServer,
    opts: { wantsOAuth: boolean },
  ) => {
    if (opts.wantsOAuth) {
      // Bridge the gap until the new row arrives in `serversQuery`
      // and shows its own "Connecting…" state. A freshly created row
      // has no saved port yet, so use the probed one.
      showInfo(`Connecting OAuth for "${created.name}"…`);
      await runAutoConnect(created.id, {
        showToast: true,
        callbackPort:
          typeof callbackPort === "number" ? callbackPort : undefined,
      });
    } else {
      await runProbe(created.id);
    }
  };

  const onConnect = async (serverId: number) => {
    const server = servers.find((s) => s.id === serverId);
    // Catalog rows are added without a saved callback port, so a
    // Connect from the card would fall back to the default port and
    // fail if it's occupied. Use the probed port for rows with none
    // saved; rows with a saved port keep it so it matches their
    // registered redirect URI.
    const usesProbedPort =
      server != null &&
      server.oauthCallbackPort == null &&
      typeof callbackPort === "number";
    await runAutoConnect(serverId, {
      callbackPort: usesProbedPort ? callbackPort : undefined,
    });
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
      // The update re-runs discovery, which is what the alert reads.
      await updateServer({ id: serverId, oauthEnabled: false });
      setConnectFeedback(null);
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
  // the live probe status so the alert stays put. Auth kinds are built
  // on each read, so they clear as soon as discovery stops seeing a 401.
  const feedbackFor = (server: McpServer): ConnectFeedback | null => {
    if (connectFeedback && connectFeedback.serverId === server.id) {
      return connectFeedback;
    }
    if (!server.oauthEnabled && statusByServer[server.id] === "unauthorized") {
      // If the catalog says this server needs an API key, treat a 401 as
      // a bad key rather than a sign that OAuth is required.
      const wantsKey =
        server.catalogSlug != null && slugsNeedingKey.has(server.catalogSlug);
      if (wantsKey) {
        return {
          serverId: server.id,
          kind: "credentials",
          message:
            "This server rejected the provided credentials. Check that your API key or token is correct.",
        };
      }
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
