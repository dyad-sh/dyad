import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plug, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  usePendingPluginSuggestions,
  useUserInputReadModel,
} from "@/user_input/hooks";
import type { PendingPluginSuggestion } from "@/user_input/selectors";
import { invalidateMcpQueries } from "@/components/plugins/invalidateMcpQueries";
import { usePluginConnect } from "@/components/plugins/usePluginConnect";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";

interface DyadSuggestPluginProps {
  slug: string;
  name?: string;
  reason: string;
  /** The parked request this card belongs to; only pending cards carry it. */
  requestId?: string;
  outcome?: "pending" | "connected" | "declined" | "never" | "dismissed";
}

/**
 * The agent's mid-task offer to connect a catalog plugin. One click adds
 * the plugin and, when it needs OAuth, runs the browser authorization; the
 * response then arms a follow-up turn so the agent resumes with the new
 * tools. Styled apart from consent prompts because adding a plugin grants
 * the agent a new capability rather than approving a single call.
 */
export const DyadSuggestPlugin: React.FC<DyadSuggestPluginProps> = ({
  slug,
  name,
  reason,
  requestId,
  outcome,
}) => {
  const { t } = useTranslation("chat");
  const chatId = useAtomValue(selectedChatIdAtom);
  const pendingSuggestions = usePendingPluginSuggestions();

  const pendingForChat =
    chatId != null ? pendingSuggestions.get(chatId) : undefined;
  // A card is live only for the request it was written for.
  const pending =
    pendingForChat && requestId && pendingForChat.requestId === requestId
      ? pendingForChat
      : undefined;
  const displayName = pending?.serverName ?? name ?? slug;

  if (outcome === "connected") {
    return (
      <DyadCard
        accentColor="green"
        state="finished"
        data-testid="plugin-suggestion-connected"
      >
        <DyadCardHeader icon={<CheckCircle2 size={15} />} accentColor="green">
          <DyadBadge color="green">{t("suggestPlugin.badge")}</DyadBadge>
          <span className="text-sm font-medium text-foreground">
            {t("suggestPlugin.connectedTitle", { name: displayName })}
          </span>
        </DyadCardHeader>
        <div className="px-3 pb-3 flex flex-col gap-1">
          {reason && <p className="text-xs text-foreground/80">{reason}</p>}
          <p className="text-xs text-muted-foreground">
            {t("suggestPlugin.connectedDescription")}
          </p>
        </div>
      </DyadCard>
    );
  }

  if (outcome === "declined" || outcome === "never") {
    const isNever = outcome === "never";
    return (
      <DyadCard
        accentColor="slate"
        state="finished"
        data-testid={
          isNever ? "plugin-suggestion-never" : "plugin-suggestion-declined"
        }
      >
        <DyadCardHeader icon={<Plug size={15} />} accentColor="slate">
          <DyadBadge color="slate">{t("suggestPlugin.badge")}</DyadBadge>
          <span className="text-sm font-medium text-foreground">
            {isNever
              ? t("suggestPlugin.neverTitle", { name: displayName })
              : t("suggestPlugin.declinedTitle", { name: displayName })}
          </span>
        </DyadCardHeader>
        <div className="px-3 pb-3 flex flex-col gap-1">
          {reason && <p className="text-xs text-foreground/80">{reason}</p>}
          <p className="text-xs text-muted-foreground">
            {isNever
              ? t("suggestPlugin.neverDescription")
              : t("suggestPlugin.declinedDescription")}
          </p>
        </div>
      </DyadCard>
    );
  }

  // Once the durable pending card settles, its appended terminal card owns
  // the historical presentation. Dismissed requests have no terminal UI.
  if (outcome === "dismissed" || !pending) return null;

  return <PendingSuggestionCard pending={pending} />;
};

type ConnectPhase = "idle" | "adding" | "authorizing" | "declining";

// The live card owns the connect hooks so historical cards stay cheap.
function PendingSuggestionCard({
  pending,
}: {
  pending: PendingPluginSuggestion;
}) {
  const { t } = useTranslation("chat");
  const readModel = useUserInputReadModel();
  const queryClient = useQueryClient();
  const { connectNewServer, connectingServerId } = usePluginConnect();
  const [phase, setPhase] = useState<ConnectPhase>("idle");
  // Kept on the card so a failure outlives its toast. By then the plugin
  // may already be added, and the user needs to see it still needs work.
  const [connectError, setConnectError] = useState<string | null>(null);

  const displayName = pending.serverName;
  // Another connect flow anywhere in the app holds the shared slot.
  const isBusy =
    pending.isResponding || phase !== "idle" || connectingServerId !== null;

  const handleConnect = async () => {
    if (isBusy) return;
    setPhase("adding");
    setConnectError(null);
    try {
      // Only one-click entries are suggestable (http, no inputs). Adding is
      // idempotent, so a plugin that already exists comes back as its row,
      // which may be disabled and may still hold its authorization.
      const created = await ipc.mcp.addFromCatalog({ slug: pending.slug });
      if (!created.enabled) {
        await ipc.mcp.updateServer({ id: created.id, enabled: true });
      }
      // Not awaited: the refetch runs tool discovery on every plugin, and
      // the one just added can sit in that until its timeout when it is
      // not authorized yet. Connecting must not wait on it.
      void invalidateMcpQueries(queryClient);
      // The row may have been authorized elsewhere since the card appeared.
      if (pending.needsOAuth && !created.oauthConnected) {
        setPhase("authorizing");
        const connected = await connectNewServer(created);
        void invalidateMcpQueries(queryClient);
        if (!connected) {
          // The shared flow already toasted the specific reason, which may
          // be unrelated to authorization, so the card stays general.
          setConnectError(t("suggestPlugin.connectFailed"));
          setPhase("idle");
          return;
        }
      }
      // Added and authorized are not the same as reachable; the agent
      // should only be told the plugin is ready when its server answers.
      const probe = await ipc.mcp.probeConnection(created.id);
      if (probe.status !== "ok") {
        // A 401 means the server answered and wants authorization, which
        // calls for a different next step than a server that is down.
        const headline =
          probe.status === "unauthorized"
            ? t("suggestPlugin.authRequired")
            : t("suggestPlugin.unreachable");
        showError(probe.error ? `${headline}\n${probe.error}` : headline);
        setConnectError(headline);
        setPhase("idle");
        return;
      }
      // Stay in the busy state on success: the card unmounts once the
      // request settles, and resetting first would flash the idle button.
      const responded = await readModel.respond(pending.requestId, {
        kind: "plugin-suggestion",
        outcome: "connected",
      });
      if (!responded) setPhase("idle");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("suggestPlugin.failed");
      showError(message);
      setConnectError(message);
      setPhase("idle");
    }
  };

  // "Not now" holds for this conversation; "never" is stored per plugin.
  const handleDecline = async (outcome: "declined" | "never") => {
    if (isBusy) return;
    setPhase("declining");
    setConnectError(null);
    let responded = false;
    try {
      responded = await readModel.respond(pending.requestId, {
        kind: "plugin-suggestion",
        outcome,
      });
    } finally {
      if (!responded) setPhase("idle");
    }
  };

  const statusText =
    phase === "adding"
      ? t("suggestPlugin.adding")
      : phase === "authorizing"
        ? t("suggestPlugin.authorizing")
        : phase === "declining"
          ? t("suggestPlugin.declining")
          : "";
  const connectLabel =
    phase === "adding" || phase === "authorizing"
      ? statusText
      : t("suggestPlugin.connect", { name: displayName });

  return (
    <DyadCard
      accentColor="violet"
      showAccent
      className="bg-gradient-to-br from-violet-50/70 to-transparent dark:from-violet-950/30"
      data-testid="plugin-suggestion-card"
    >
      <DyadCardHeader icon={<Sparkles size={15} />} accentColor="violet">
        <DyadBadge color="violet">{t("suggestPlugin.badge")}</DyadBadge>
        <span className="text-sm font-semibold text-foreground">
          {t("suggestPlugin.title", { name: displayName })}
        </span>
      </DyadCardHeader>
      <div className="px-3 pb-3 flex flex-col gap-3">
        <div className="rounded-md border border-violet-200/80 bg-violet-50/60 px-3 py-2 dark:border-violet-900/60 dark:bg-violet-950/40">
          <p className="text-[11px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
            {t("suggestPlugin.reasonLabel")}
          </p>
          <p className="mt-0.5 text-sm text-foreground">{pending.reason}</p>
        </div>
        {pending.serverDescription && (
          <p className="text-xs text-muted-foreground leading-snug">
            {pending.serverDescription}
          </p>
        )}
        {connectError && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
            data-testid="plugin-suggestion-error"
          >
            {connectError}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            onClick={() => void handleDecline("declined")}
            disabled={isBusy}
            variant="ghost"
            size="sm"
            className="sm:-ml-3"
            data-testid="plugin-suggestion-decline-button"
          >
            {phase === "declining" && (
              <Loader2 size={14} className="animate-spin" />
            )}
            {phase === "declining" ? statusText : t("suggestPlugin.notNow")}
          </Button>
          <Button
            onClick={() => void handleConnect()}
            disabled={isBusy}
            size="sm"
            className="w-full sm:w-auto bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
            data-testid="plugin-suggestion-connect-button"
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
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            {pending.needsOAuth
              ? t("suggestPlugin.oauthHint")
              : t("suggestPlugin.hint")}
          </p>
          <button
            type="button"
            onClick={() => void handleDecline("never")}
            disabled={isBusy}
            className="shrink-0 self-start text-[11px] text-muted-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground hover:decoration-foreground disabled:pointer-events-none disabled:opacity-50 sm:self-auto"
            data-testid="plugin-suggestion-never-button"
          >
            {t("suggestPlugin.never")}
          </button>
        </div>
      </div>
    </DyadCard>
  );
}
