import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ipc, type LovableConnectionStatus } from "@/ipc/types";
import {
  LOVABLE_MCP_ACCESS_URL,
  LOVABLE_MCP_DOCS_URL,
  LOVABLE_MCP_SERVER_URL,
  LOVABLE_OAUTH_PUBLIC_CLIENT_ID,
} from "@/lib/lovableMcp";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

async function copyServerUrl() {
  try {
    await navigator.clipboard.writeText(LOVABLE_MCP_SERVER_URL);
    showSuccess("Lovable MCP server URL copied.");
  } catch {
    showError("Could not copy the Lovable MCP server URL.");
  }
}

export function LovablePluginSettings() {
  const [accessApproved, setAccessApproved] = useState(false);
  const queryClient = useQueryClient();
  const statusQuery = useQuery<LovableConnectionStatus>({
    queryKey: queryKeys.mcp.lovableStatus,
    queryFn: () => ipc.mcp.getLovableStatus(),
    refetchOnWindowFocus: true,
  });

  const refreshMcpState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.lovableStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.toolsByServer.all,
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.connectionStatuses.all,
      }),
    ]);
  };

  const connectMutation = useMutation({
    mutationFn: () => ipc.mcp.connectLovable(),
    onSuccess: async (status) => {
      await refreshMcpState();
      if (status.state === "connected") {
        showSuccess("Lovable connected.");
      } else {
        showError(status.error || "Lovable authorization failed.");
      }
    },
    onError: (error) => {
      showError(
        error instanceof Error
          ? error.message
          : "Lovable authorization failed.",
      );
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => ipc.mcp.disconnectLovable(),
    onSuccess: async () => {
      setAccessApproved(false);
      await refreshMcpState();
      showSuccess("Lovable disconnected from this device.");
    },
    onError: (error) => {
      showError(
        error instanceof Error
          ? error.message
          : "Could not disconnect Lovable.",
      );
    },
  });

  const status = statusQuery.data;
  const isConnected = status?.state === "connected";
  const isBusy = connectMutation.isPending || disconnectMutation.isPending;

  return (
    <div className="space-y-4">
      <div
        className={
          isConnected
            ? "rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3"
            : status?.state === "error"
              ? "rounded-lg border border-red-400/20 bg-red-400/5 p-3"
              : "rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3"
        }
      >
        <div className="flex items-start gap-2.5">
          {statusQuery.isLoading ? (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-cyan-300" />
          ) : isConnected ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-cyan-300" />
          )}
          <div className="space-y-1">
            <p className="text-sm font-medium text-cyan-50">
              {statusQuery.isLoading
                ? "Checking Lovable…"
                : isConnected
                  ? "Lovable connected"
                  : status?.state === "error"
                    ? "Lovable needs attention"
                    : "Lovable not connected"}
            </p>
            <p className="text-xs leading-5 text-cyan-100/60">
              {isConnected
                ? `${status.toolCount ?? 0} Lovable tools are ready for Web Dev and approved assistant actions.`
                : status?.error ||
                  "Approve access, then authorize with Lovable in your browser."}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="settings-lovable-mcp-url"
          className="text-sm font-medium text-cyan-50"
        >
          Official MCP server
        </label>
        <div className="flex gap-2">
          <Input
            id="settings-lovable-mcp-url"
            readOnly
            value={LOVABLE_MCP_SERVER_URL}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Copy Lovable MCP server URL"
            onClick={() => void copyServerUrl()}
          >
            <Copy className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-card/35 p-3">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-cyan-300" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Approved Lovable OAuth client
          </p>
          <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
            {LOVABLE_OAUTH_PUBLIC_CLIENT_ID}
          </p>
        </div>
      </div>

      {!isConnected && (
        <label
          htmlFor="lovable-access-approval"
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-card/40 p-3"
        >
          <Checkbox
            id="lovable-access-approval"
            checked={accessApproved}
            onCheckedChange={(checked) => setAccessApproved(checked === true)}
            disabled={isBusy}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ShieldCheck className="size-4 text-amber-300" />
              Approve full Lovable account access
            </span>
            <span className="block text-xs leading-5 text-muted-foreground">
              Web Dev can list, read, create, edit, and deploy projects
              available to your Lovable account. Calls can use credits and
              change live projects; individual tool permission prompts still
              apply.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isConnected ? (
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={() => disconnectMutation.mutate()}
          >
            {disconnectMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            Disconnect
          </Button>
        ) : (
          <Button
            type="button"
            disabled={!accessApproved || isBusy}
            onClick={() => connectMutation.mutate()}
          >
            {connectMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {connectMutation.isPending
              ? "Waiting for approval…"
              : "Approve & sign in"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => void ipc.system.openExternalUrl(LOVABLE_MCP_DOCS_URL)}
        >
          Setup guide <ExternalLink className="ml-1 size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            void ipc.system.openExternalUrl(LOVABLE_MCP_ACCESS_URL)
          }
        >
          Open Lovable <ExternalLink className="ml-1 size-3.5" />
        </Button>
      </div>

      <p className="text-xs leading-5 text-cyan-100/45">
        OAuth tokens are encrypted with this device&apos;s secure storage. Use
        Disconnect to remove the local authorization.
      </p>
    </div>
  );
}
