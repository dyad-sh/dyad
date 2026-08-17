import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Loader2,
  LogOut,
  Palette,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ipc, type CanvaConnectionStatus } from "@/ipc/types";
import {
  CANVA_ACCESS_URL,
  CANVA_MCP_DOCS_URL,
  CANVA_MCP_SERVER_URL,
} from "@/lib/canvaMcp";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

export function CanvaPluginSettings() {
  const [accessApproved, setAccessApproved] = useState(false);
  const queryClient = useQueryClient();
  const statusQuery = useQuery<CanvaConnectionStatus>({
    queryKey: queryKeys.mcp.canvaStatus,
    queryFn: () => ipc.mcp.getCanvaStatus(),
    refetchOnWindowFocus: true,
  });

  const refreshMcpState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.canvaStatus }),
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
    mutationFn: () => ipc.mcp.connectCanva(),
    onSuccess: async (status) => {
      await refreshMcpState();
      if (status.state === "connected") {
        showSuccess("Canva connected.");
      } else {
        showError(status.error || "Canva authorization failed.");
      }
    },
    onError: (error) => {
      showError(
        error instanceof Error ? error.message : "Canva authorization failed.",
      );
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => ipc.mcp.disconnectCanva(),
    onSuccess: async () => {
      setAccessApproved(false);
      await refreshMcpState();
      showSuccess("Canva disconnected from this device.");
    },
    onError: (error) => {
      showError(
        error instanceof Error ? error.message : "Could not disconnect Canva.",
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
            <p className="text-sm font-medium text-foreground">
              {statusQuery.isLoading
                ? "Checking Canva…"
                : isConnected
                  ? "Canva connected"
                  : status?.state === "error"
                    ? "Canva needs attention"
                    : "Canva not connected"}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {isConnected
                ? `${status.toolCount ?? 0} Canva tools are ready for approved Chat Agent actions.`
                : status?.error ||
                  "Approve access, then sign in to your Canva account in the browser."}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-card/35 p-3">
        <Palette className="mt-0.5 size-4 shrink-0 text-cyan-300" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Official Canva MCP server
          </p>
          <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
            {CANVA_MCP_SERVER_URL}
          </p>
        </div>
      </div>

      {!isConnected && (
        <label
          htmlFor="canva-access-approval"
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-card/40 p-3"
        >
          <Checkbox
            id="canva-access-approval"
            checked={accessApproved}
            onCheckedChange={(checked) => setAccessApproved(checked === true)}
            disabled={isBusy}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ShieldCheck className="size-4 text-amber-300" />
              Approve Canva design access
            </span>
            <span className="block text-xs leading-5 text-muted-foreground">
              Canva tools can find, create, edit and export designs available to
              your account. Generation can consume Canva credits; each tool call
              still follows the app&apos;s permission prompts.
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
              ? "Waiting for Canva…"
              : "Approve & sign in"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => void ipc.system.openExternalUrl(CANVA_MCP_DOCS_URL)}
        >
          Setup guide <ExternalLink className="ml-1 size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void ipc.system.openExternalUrl(CANVA_ACCESS_URL)}
        >
          Open Canva <ExternalLink className="ml-1 size-3.5" />
        </Button>
      </div>

      <p className="text-xs leading-5 text-cyan-100/45">
        Canva requires an individual account sign-in. OAuth tokens and the MCP
        client registration are encrypted in this device&apos;s secure storage.
      </p>
    </div>
  );
}
