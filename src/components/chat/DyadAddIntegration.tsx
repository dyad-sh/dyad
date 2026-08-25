import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { usePaneChatId } from "./ChatPaneContext";
import { integrationProviderSelectionAtom } from "@/atoms/integrationAtoms";
import { usePendingIntegrations } from "@/user_input/hooks";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useNeon } from "@/hooks/useNeon";
import { useIntegrationContinue } from "@/hooks/useIntegrationContinue";
import { useTranslation } from "react-i18next";
import { isNeonSupportedFramework } from "@/lib/framework_constants";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";
import { getCompletedIntegrationProvider } from "./dyadAddIntegrationUtils";
import { ipc } from "@/ipc/types";

interface DyadAddIntegrationProps {
  children: React.ReactNode;
  provider?: "neon" | "supabase";
  outcome?: "pending" | "skipped" | "completed" | "dismissed";
}

export const DyadAddIntegration: React.FC<DyadAddIntegrationProps> = ({
  children,
  provider: requestedProvider,
  outcome,
}) => {
  const { t } = useTranslation("home");
  const appId = useAtomValue(selectedAppIdAtom);
  const chatId = usePaneChatId();
  const pendingIntegrationMap = usePendingIntegrations();
  const setIntegrationProviderSelection = useSetAtom(
    integrationProviderSelectionAtom,
  );
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const pendingIntegration =
    chatId != null ? pendingIntegrationMap.get(chatId) : undefined;
  const { app } = useLoadApp(appId);
  const { projectInfo, isLoadingBranches } = useNeon(appId);
  const isNeonSupported = isNeonSupportedFramework({
    files: app?.files,
    frameworkType: app?.frameworkType ?? null,
  });

  // Track explicit user choice. The effective `selectedProvider` is derived
  // below so it stays reactive to `pendingIntegration?.provider`, which can
  // arrive via IPC after this component mounts.
  const [userSelectedProvider, setUserSelectedProvider] = useState<
    "neon" | "supabase" | null
  >(null);
  // True after the user clicks Next: the chat card collapses to a "finish in
  // the right panel" message with a Back button.
  const [inPanelMode, setInPanelMode] = useState(false);

  const providerOptions = [
    {
      id: "supabase" as const,
      name: t("integrations.databaseSetup.providers.supabase.name"),
      description: t(
        "integrations.databaseSetup.providers.supabase.description",
      ),
      url: "https://supabase.com",
    },
    {
      id: "neon" as const,
      name: t("integrations.databaseSetup.providers.neon.name"),
      description: t("integrations.databaseSetup.providers.neon.description"),
      url: "https://neon.tech",
    },
  ];

  // Derived: prefer explicit user choice, then tool-locked, then AI-requested
  // (from the IPC-driven read model), then default. Re-derives every render so a
  // late `pendingIntegration?.provider` is reflected without a sync effect.
  const selectedProvider =
    userSelectedProvider ??
    requestedProvider ??
    pendingIntegration?.provider ??
    "supabase";

  const lockedProvider = requestedProvider ?? pendingIntegration?.provider;

  // Determine which providers to show
  const availableProviders = (() => {
    // If a specific provider was requested (via tool arg or pending request),
    // show only that one (but fall back to supabase if neon was requested for
    // an unsupported framework)
    if (lockedProvider) {
      if (lockedProvider === "neon" && !isNeonSupported) {
        return providerOptions.filter((p) => p.id === "supabase");
      }
      return providerOptions.filter((p) => p.id === lockedProvider);
    }
    // No provider specified: show neon only for frameworks that support it
    if (!isNeonSupported) {
      return providerOptions.filter((p) => p.id !== "neon");
    }
    return providerOptions;
  })();

  // When only one provider is available, treat it as pre-selected
  const effectiveSelectedProvider =
    availableProviders.length === 1
      ? availableProviders[0].id
      : selectedProvider;

  const radioGroupRef = useRef<HTMLDivElement>(null);

  const handleRadioKeyDown = (e: React.KeyboardEvent) => {
    // Mirror the click handler's disabled check: don't let keyboard arrow
    // navigation change the selection in non-interactive (historical) renders
    // or when only one provider is available.
    if (!pendingIntegration || availableProviders.length === 1) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
      return;
    e.preventDefault();

    const buttons =
      radioGroupRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      );
    if (!buttons || buttons.length === 0) return;

    const currentIndex = Array.from(buttons).findIndex(
      (btn) => btn === document.activeElement,
    );
    const nextIndex =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (currentIndex + 1) % buttons.length
        : (currentIndex - 1 + buttons.length) % buttons.length;

    buttons[nextIndex].focus();
    const providerId = availableProviders[nextIndex]?.id;
    if (providerId) setUserSelectedProvider(providerId);
  };

  const completedProvider = getCompletedIntegrationProvider(app);
  const displayedCompletedProvider =
    outcome === "completed" && requestedProvider
      ? requestedProvider
      : completedProvider;
  const completedProviderName =
    displayedCompletedProvider === "supabase"
      ? t("integrations.databaseSetup.providers.supabase.name")
      : displayedCompletedProvider === "neon"
        ? t("integrations.databaseSetup.providers.neon.name")
        : null;

  const integrationLabel =
    completedProvider === "supabase" && app?.supabaseProjectName
      ? app.supabaseProjectName
      : completedProvider === "neon" && app?.neonProjectId
        ? (projectInfo?.projectName ??
          (isLoadingBranches ? null : app.neonProjectId))
        : null;
  const showIntegrationLabelSkeleton =
    completedProvider === "neon" &&
    !!app?.neonProjectId &&
    isLoadingBranches &&
    !projectInfo?.projectName;

  const handleNextClick = () => {
    if (!effectiveSelectedProvider || chatId == null || !pendingIntegration)
      return;
    // Share the UI choice with the Configure panel without mutating the
    // main-authoritative request read model.
    setIntegrationProviderSelection((prev) => {
      if (prev.get(pendingIntegration.requestId) === effectiveSelectedProvider)
        return prev;
      const next = new Map(prev);
      next.set(pendingIntegration.requestId, effectiveSelectedProvider);
      return next;
    });
    // Surface the right-sidebar Configure tab where the integration setup now lives.
    setPreviewMode("configure");
    setIsPreviewOpen(true);
    setInPanelMode(true);
  };

  const {
    canContinue,
    canSkip,
    isSubmitting: isContinueSubmitting,
    handleContinue,
    handleSkip,
  } = useIntegrationContinue(chatId);

  const handleSkipClick = () => void handleSkip();

  const handleBackClick = () => {
    setInPanelMode(false);
    setUserSelectedProvider(null);
    // Drop the chosen provider from the pending integration so the Configure
    // panel collapses and the radios reopen with no preselection. (The
    // tool-locked provider, if any, is still preserved via `requestedProvider`
    // and continues to constrain `availableProviders`.)
    if (pendingIntegration) {
      setIntegrationProviderSelection((prev) => {
        if (!prev.has(pendingIntegration.requestId)) return prev;
        const next = new Map(prev);
        next.delete(pendingIntegration.requestId);
        return next;
      });
    }
  };

  // A durable tool outcome describes what happened in this conversation and
  // must win over the app's provider state today.
  if (outcome === "skipped") {
    return (
      <DyadCard accentColor="slate" state="finished">
        <DyadCardHeader icon={<Database size={15} />} accentColor="slate">
          <DyadBadge color="slate">
            {t("integrations.databaseSetup.integrationSkipped")}
          </DyadBadge>
          <span className="text-sm font-medium text-foreground">
            {t("integrations.databaseSetup.skippedDescription")}
          </span>
        </DyadCardHeader>
      </DyadCard>
    );
  }

  // Final completed view: either the terminal tool outcome recorded it, or a
  // legacy card without an outcome can derive it from the current app state.
  if (
    outcome === "completed" ||
    (outcome === undefined && completedProvider && !pendingIntegration)
  ) {
    return (
      <DyadCard accentColor="green" state="finished">
        <DyadCardHeader icon={<CheckCircle2 size={15} />} accentColor="green">
          <DyadBadge color="green">
            {t("integrations.databaseSetup.integrationComplete")}
          </DyadBadge>
          <span className="text-sm font-medium text-foreground">
            {t("integrations.databaseSetup.completeDescription", {
              provider: completedProviderName,
            })}
          </span>
        </DyadCardHeader>
        <div className="px-3 pb-3">
          <p className="text-sm text-muted-foreground">
            {t("integrations.databaseSetup.connectedToProject", {
              provider: completedProviderName,
            })}{" "}
            {showIntegrationLabelSkeleton ? (
              <Skeleton className="inline-block h-6 w-28 align-middle rounded bg-green-100/80 dark:bg-green-900/50" />
            ) : (
              <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200">
                {integrationLabel ?? "—"}
              </span>
            )}
          </p>
        </div>
      </DyadCard>
    );
  }

  // Once the durable pending card settles, its appended terminal card owns the
  // historical presentation. Dismissed requests have no terminal UI.
  if (!pendingIntegration && (outcome === "pending" || outcome === "dismissed"))
    return null;

  // If there is no pending request for this chat and no completion, this is a
  // stale/historical render — show the radios in a read-only display state with
  // no Next button (nothing to resolve).
  const isInteractive = !!pendingIntegration;

  return (
    <DyadCard accentColor="blue">
      <DyadCardHeader icon={<Database size={15} />} accentColor="blue">
        <DyadBadge color="blue">
          {t("integrations.databaseSetup.badge")}
        </DyadBadge>
        <span className="text-sm font-medium text-foreground">
          {t("integrations.databaseSetup.chooseProvider")}
        </span>
      </DyadCardHeader>
      <div className="px-3 pb-3">
        {children && (
          <div className="text-xs text-muted-foreground mb-3">{children}</div>
        )}
        {isInteractive && inPanelMode && effectiveSelectedProvider ? (
          <>
            <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
              <div className="flex items-center gap-2 font-medium">
                <ArrowRight size={14} />
                <span>
                  {t("integrations.databaseSetup.configureInPanelTitle")}
                </span>
              </div>
              <p className="mt-1 text-xs text-blue-800/90 dark:text-blue-200/80">
                {t("integrations.databaseSetup.configureInPanelDescription", {
                  provider:
                    effectiveSelectedProvider === "supabase"
                      ? t("integrations.databaseSetup.providers.supabase.name")
                      : t("integrations.databaseSetup.providers.neon.name"),
                })}
              </p>
            </div>
            {/* Mirror the right-panel Continue button here so users don't have
                to hunt for it in the Configure panel once the connector is
                done. Both buttons share state via useIntegrationContinue, so
                clicking one disables both. */}
            <Button
              onClick={handleContinue}
              disabled={!canContinue || isContinueSubmitting}
              className="w-full mt-3"
              size="sm"
              data-testid="integration-chat-continue-button"
            >
              {isContinueSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t("integrations.databaseSetup.continuing")}
                </>
              ) : (
                t("integrations.databaseSetup.continue")
              )}
            </Button>
            <Button
              onClick={handleBackClick}
              variant="outline"
              className="w-full mt-2"
              size="sm"
            >
              <ArrowLeft size={14} />
              {t("integrations.databaseSetup.back")}
            </Button>
          </>
        ) : (
          <>
            <div
              ref={radioGroupRef}
              role="radiogroup"
              aria-label={t("integrations.databaseSetup.chooseProvider")}
              onKeyDown={handleRadioKeyDown}
              className={`grid ${availableProviders.length > 1 ? "grid-cols-2" : "grid-cols-1"} gap-3`}
            >
              {availableProviders.map((option, index) => {
                const isSelected = effectiveSelectedProvider === option.id;
                const disableSwitch =
                  !isInteractive || availableProviders.length === 1;
                return (
                  <div
                    key={option.id}
                    className={`relative rounded-lg border-2 transition-colors ${
                      isSelected
                        ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/30"
                        : `border-border ${disableSwitch ? "" : "hover:border-blue-400"}`
                    }`}
                  >
                    <button
                      type="button"
                      role="radio"
                      tabIndex={
                        isSelected ||
                        (!effectiveSelectedProvider && index === 0)
                          ? 0
                          : -1
                      }
                      onClick={() => {
                        if (disableSwitch) return;
                        setUserSelectedProvider(option.id);
                      }}
                      aria-checked={isSelected}
                      aria-disabled={disableSwitch}
                      className={`flex h-full w-full flex-col items-start gap-2 rounded-md p-3 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${disableSwitch ? "cursor-default" : "cursor-pointer"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {option.name}
                        </span>
                        {option.id === "supabase" && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">
                            {t("integrations.databaseSetup.recommended")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-snug">
                        {option.description}
                      </p>
                    </button>
                    <a
                      href={option.url}
                      onClick={(e) => {
                        e.preventDefault();
                        if (isInteractive) {
                          ipc.system.openExternalUrl(option.url);
                        }
                      }}
                      aria-disabled={!isInteractive}
                      tabIndex={isInteractive ? 0 : -1}
                      className={`absolute right-3 top-3 rounded text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isInteractive ? "hover:text-foreground" : "pointer-events-none"}`}
                      aria-label={t(
                        "integrations.databaseSetup.visitProviderWebsite",
                        { provider: option.name },
                      )}
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                );
              })}
            </div>

            {isInteractive && (
              <div className="mt-3 flex flex-col-reverse gap-3 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
                {canSkip && (
                  <div className="min-w-0">
                    <Button
                      onClick={handleSkipClick}
                      disabled={isContinueSubmitting}
                      variant="ghost"
                      className="-ml-3"
                      size="sm"
                      data-testid="integration-skip-button"
                    >
                      {isContinueSubmitting ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          {t("integrations.databaseSetup.skipping")}
                        </>
                      ) : (
                        t("integrations.databaseSetup.skipForNow")
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.databaseSetup.skipReassurance")}
                    </p>
                  </div>
                )}
                <Button
                  onClick={handleNextClick}
                  disabled={!effectiveSelectedProvider}
                  className="w-full sm:w-auto"
                  size="sm"
                >
                  {t("integrations.databaseSetup.continueWithProvider", {
                    provider:
                      effectiveSelectedProvider === "supabase"
                        ? t(
                            "integrations.databaseSetup.providers.supabase.name",
                          )
                        : t("integrations.databaseSetup.providers.neon.name"),
                  })}
                  <ArrowRight size={14} />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </DyadCard>
  );
};
