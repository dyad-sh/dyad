import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cloud, Loader2 } from "lucide-react";

import { ipc } from "@/ipc/types";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Vercel Blob connection management. Connects a store read/write token
 * (BLOB_READ_WRITE_TOKEN) so generated images/assets persist to the cloud.
 * App-independent — the token lives in global settings.
 */
export function VercelBlobConnectionSettings({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
  const hasIpc = isIpcRendererAvailable();
  const statusQuery = useQuery({
    queryKey: queryKeys.vercelBlob.status,
    queryFn: () => ipc.vercelBlob.status(),
    enabled: hasIpc,
  });
  const connected = statusQuery.data?.connected ?? false;

  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.vercelBlob.all });

  const connect = async () => {
    const value = token.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await ipc.vercelBlob.connect({ token: value });
      setToken("");
      await refresh();
      showSuccess("Vercel Blob connected");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await ipc.vercelBlob.disconnect();
      await refresh();
      showSuccess("Vercel Blob disconnected");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={
        embedded
          ? ""
          : "rounded-xl border border-cyan-400/15 bg-slate-950/35 p-4"
      }
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-cyan-50">Vercel Blob</h3>
        {connected ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
            data-testid="vercel-blob-connected"
          >
            <CheckCircle2 className="size-3.5" /> Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <span className="size-1.5 rounded-full bg-gray-400" /> Not connected
          </span>
        )}
      </div>
      <p className="mt-1 mb-3 text-xs leading-5 text-cyan-100/50">
        Paste the read/write token from your Vercel Blob store. The token is
        encrypted on this device and is only used when Cloud storage is selected
        (
        <code className="rounded bg-cyan-950/70 px-1 text-cyan-200/70">
          BLOB_READ_WRITE_TOKEN
        </code>
        ) from your Vercel project.
      </p>

      {connected ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void disconnect()}
          disabled={busy}
          data-testid="vercel-blob-disconnect"
        >
          {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
          Disconnect
        </Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="password"
            autoComplete="off"
            placeholder="vercel_blob_rw_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void connect();
            }}
            className="font-mono text-sm sm:max-w-md"
            data-testid="vercel-blob-token"
          />
          <Button
            onClick={() => void connect()}
            disabled={!token.trim() || busy}
            data-testid="vercel-blob-connect"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Connecting
              </>
            ) : (
              <>
                <Cloud className="mr-2 size-4" />
                Connect
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
