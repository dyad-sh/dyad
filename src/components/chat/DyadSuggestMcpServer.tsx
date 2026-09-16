import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plug, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  usePendingMcpSuggestions,
  useUserInputReadModel,
} from "@/user_input/hooks";
import type { PendingMcpSuggestion } from "@/user_input/selectors";
import { invalidateMcpQueries } from "@/components/plugins/invalidateMcpQueries";
import { usePluginConnect } from "@/components/plugins/usePluginConnect";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";
import { useDyadMessageId } from "./messageContext";

interface DyadSuggestMcpServerProps {
  children?: React.ReactNode;
  slug: string;
  /** Present on terminal cards; the live card reads it from the request. */
  name?: string;
  reason: string;
  outcome?: "pending" | "connected" | "declined" | "dismissed";
}

/**
 * The agent's mid-task offer to connect a catalog plugin. One click adds
 * the plugin and, when it needs OAuth, runs the browser authorization; the
 * response then arms a follow-up turn so the agent resumes with the new
 * tools. Styled apart from consent prompts because adding a plugin grants
 * the agent a new capability rather than approving a single call.
 */
export const DyadSuggestMcpServer: React.FC<DyadSuggestMcpServerProps> = ({
  children,
  slug,
  name,
  reason,
  outcome,
}) => {
  const { t } = useTranslation("chat");
  const chatId = useAtomValue(selectedChatIdAtom);
  const messageId = useDyadMessageId();
  const pendingSuggestions = usePendingMcpSuggestions();

  const pendingForChat =
    chatId != null ? pendingSuggestions.get(chatId) : undefined;
  // Only the card raised by the live request is live: same plugin, same
  // reason, and the same message. Matching the reason separates parallel
  // calls for one plugin within a message. A card rendered outside a
  // persisted message has no id to compare, so it skips that check.
  const pending =
    pendingForChat &&
    pendingForChat.slug === slug &&
    pendingForChat.reason === reason &&
    (messageId === undefined || pendingForChat.messageId === messageId)
      ? pendingForChat
      : undefined;
  const displayName = pending?.serverName ?? name ?? slug;

  if (outcome === "connected") {
    return (
      <DyadCard
        accentColor="green"
        state="finished"
        data-testid="mcp-suggestion-connected"
      >
        <DyadCardHeader icon={<CheckCircle2 size={15} />} accentColor="green">
          <DyadBadge color="green">{t("suggestMcpServer.badge")}</DyadBadge>
          <span className="text-sm font-medium text-foreground">
            {t("suggestMcpServer.connectedTitle", { name: displayName })}
          </span>
        </DyadCardHeader>
        <div className="px-3 pb-3 flex flex-col gap-1">
          {reason && <p className="text-xs text-foreground/80">{reason}</p>}
          <p className="text-xs text-muted-foreground">
            {t("suggestMcpServer.connectedDescription")}
          </p>
        </div>
      </DyadCard>
    );
  }

  if (outcome === "declined") {
    return (
      <DyadCard accentColor="slate" state="finished">
        <DyadCardHeader icon={<Plug size={15} />} accentColor="slate">
          <DyadBadge color="slate">{t("suggestMcpServer.badge")}</DyadBadge>
          <span className="text-sm font-medium text-foreground">
            {t("suggestMcpServer.declinedTitle", { name: displayName })}
          </span>
        </DyadCardHeader>
        <div className="px-3 pb-3 flex flex-col gap-1">
          {reason && <p className="text-xs text-foreground/80">{reason}</p>}
          <p className="text-xs text-muted-foreground">
            {t("suggestMcpServer.declinedDescription")}
          </p>
        </div>
      </DyadCard>
    );
  }

  // Once the durable pending card settles, its appended terminal card owns
  // the historical presentation. Dismissed requests have no terminal UI.
  if (outcome === "dismissed" || !pending) return null;

  return (
    <PendingSuggestionCard pending={pending}>{children}</PendingSuggestionCard>
  );
};

type ConnectPhase = "idle" | "adding" | "authorizing" | "declining";

// The live card owns the connect hooks so historical cards stay cheap.
function PendingSuggestionCard({
  pending,
  children,
}: {
  pending: PendingMcpSuggestion;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation("chat");
  const readModel = useUserInputReadModel();
  const queryClient = useQueryClient();
  const { connectNewServer, connectingServerId } = usePluginConnect();
  const [phase, setPhase] = useState<ConnectPhase>("idle");

  const displayName = pending.serverName;
  // Another connect flow anywhere in the app holds the shared slot.
  const isBusy =
    pending.isResponding || phase !== "idle" || connectingServerId !== null;

  const handleConnect = async () => {
    if (isBusy) return;
    setPhase("adding");
    try {
      // Only one-click entries are suggestable (http, no inputs), so the
      // row is created enabled and needs at most an OAuth step.
      const created = await ipc.mcp.addFromCatalog({ slug: pending.slug });
      await invalidateMcpQueries(queryClient);
      if (pending.oauthRequired) {
        setPhase("authorizing");
        // The shared flow toasts its own failure message.
        const connected = await connectNewServer(created);
        await invalidateMcpQueries(queryClient);
        if (!connected) return;
      }
      // Added and authorized are not the same as reachable; the agent
      // should only be told the plugin is ready when its server answers.
      const probe = await ipc.mcp.probeConnection(created.id);
      if (probe.status !== "ok") {
        // A 401 means the server answered and wants authorization, which
        // calls for a different next step than a server that is down.
        const headline =
          probe.status === "unauthorized"
            ? t("suggestMcpServer.authRequired")
            : t("suggestMcpServer.unreachable");
        showError(probe.error ? `${headline}\n${probe.error}` : headline);
        return;
      }
      await readModel.respond(pending.requestId, {
        kind: "mcp-suggestion",
        outcome: "connected",
      });
    } catch (error) {
      showError(
        error instanceof Error ? error.message : t("suggestMcpServer.failed"),
      );
    } finally {
      setPhase("idle");
    }
  };

  const handleDecline = async () => {
    if (isBusy) return;
    setPhase("declining");
    try {
      await readModel.respond(pending.requestId, {
        kind: "mcp-suggestion",
        outcome: "declined",
      });
    } finally {
      setPhase("idle");
    }
  };

  const statusText =
    phase === "adding"
      ? t("suggestMcpServer.adding")
      : phase === "authorizing"
        ? t("suggestMcpServer.authorizing")
        : phase === "declining"
          ? t("suggestMcpServer.declining")
          : "";
  const connectLabel =
    phase === "adding" || phase === "authorizing"
      ? statusText
      : t("suggestMcpServer.connect", { name: displayName });

  return (
    <DyadCard
      accentColor="violet"
      showAccent
      className="bg-gradient-to-br from-violet-50/70 to-transparent dark:from-violet-950/30"
      data-testid="mcp-suggestion-card"
    >
      <DyadCardHeader icon={<Sparkles size={15} />} accentColor="violet">
        <DyadBadge color="violet">{t("suggestMcpServer.badge")}</DyadBadge>
        <span className="text-sm font-semibold text-foreground">
          {t("suggestMcpServer.title", { name: displayName })}
        </span>
      </DyadCardHeader>
      <div className="px-3 pb-3 flex flex-col gap-3">
        {children && (
          <div className="text-xs text-muted-foreground">{children}</div>
        )}
        <div className="rounded-md border border-violet-200/80 bg-violet-50/60 px-3 py-2 dark:border-violet-900/60 dark:bg-violet-950/40">
          <p className="text-[11px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
            {t("suggestMcpServer.reasonLabel")}
          </p>
          <p className="mt-0.5 text-sm text-foreground">{pending.reason}</p>
        </div>
        {pending.serverDescription && (
          <p className="text-xs text-muted-foreground leading-snug">
            {pending.serverDescription}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            onClick={() => void handleDecline()}
            disabled={isBusy}
            variant="ghost"
            size="sm"
            className="sm:-ml-3"
            data-testid="mcp-suggestion-decline-button"
          >
            {phase === "declining" && (
              <Loader2 size={14} className="animate-spin" />
            )}
            {phase === "declining" ? statusText : t("suggestMcpServer.notNow")}
          </Button>
          <Button
            onClick={() => void handleConnect()}
            disabled={isBusy}
            size="sm"
            className="w-full sm:w-auto bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
            data-testid="mcp-suggestion-connect-button"
          >
            {phase === "adding" || phase === "authorizing" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plug size={14} />
            )}
            {connectLabel}
          </Button>
        </div>
        {/* Always mounted so assistive tech announces progress changes. */}
        <p role="status" aria-live="polite" className="sr-only">
          {statusText}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {pending.oauthRequired
            ? t("suggestMcpServer.oauthHint")
            : t("suggestMcpServer.hint")}
        </p>
      </div>
    </DyadCard>
  );
}
