import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { pendingIntegrationAtom } from "@/atoms/integrationAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
}

export const DyadAddIntegration: React.FC<DyadAddIntegrationProps> = ({
  children,
  provider: requestedProvider,
}) => {
  const { t } = useTranslation("home");
  const appId = useAtomValue(selectedAppIdAtom);
  const chatId = useAtomValue(selectedChatIdAtom);
  const [pendingIntegrationMap, setPendingIntegrationMap] = useAtom(
    pendingIntegrationAtom,
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
  // the right panel" message with a Back button. Local-only — if the user
  // navigates between chats and returns, they restart from selection (which
  // is harmless: their previous choice is still pre-selected).
  const [inPanelMode, setInPanelMode] = useState(false);

  const providerOptions = [
    {
      id: "supabase" as const,
      name: t("integrations.databaseSetup.providers.supabase.name"),
      description: t(
        "integrations.databaseSetup.providers.supabase.description",
      ),
      url: "https://supabase.com",
      experimental: false,
    },
    {
      id: "neon" as const,
      name: t("integrations.databaseSetup.providers.neon.name"),
      description: t("integrations.databaseSetup.providers.neon.description"),
      url: "https://neon.tech",
      experimental: true,
    },
  ];

  // Derived: prefer explicit user choice, then tool-locked, then AI-requested
  // (from the IPC-driven atom), then default. Re-derives every render so a
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
  const completedProviderName =
    completedProvider === "supabase"
      ? t("integrations.databaseSetup.providers.supabase.name")
      : completedProvider === "neon"
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
    // Persist the chosen provider on the pending integration so the Configure
    // panel knows which connector to render. The tool may have left provider
    // unset when it allowed the user to pick.
    setPendingIntegrationMap((prev) => {
      const existing = prev.get(chatId);
      if (!existing) return prev;
      if (existing.provider === effectiveSelectedProvider) return prev;
      const next = new Map(prev);
      next.set(chatId, { ...existing, provider: effectiveSelectedProvider });
      return next;
    });
    // Surface the right-sidebar Configure tab where the integration setup now lives.
    setPreviewMode("configure");
    setIsPreviewOpen(true);
    setInPanelMode(true);
  };

  const {
    canContinue,
    isSubmitting: isContinueSubmitting,
    handleContinue,
  } = useIntegrationContinue();

  const handleBackClick = () => {
    setInPanelMode(false);
    setUserSelectedProvider(null);
    // Drop the chosen provider from the pending integration so the Configure
    // panel collapses and the radios reopen with no preselection. (The
    // tool-locked provider, if any, is still preserved via `requestedProvider`
    // and continues to constrain `availableProviders`.)
    if (chatId != null) {
      setPendingIntegrationMap((prev) => {
        const existing = prev.get(chatId);
        if (!existing || existing.provider === undefined) return prev;
        const next = new Map(prev);
        next.set(chatId, { ...existing, provider: undefined });
        return next;
      });
    }
  };

  // Final completed view: no active pending request and the app has a linked
  // provider. This covers historical replays of completed chats too.
  if (completedProvider && !pendingIntegration) {
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
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    tabIndex={
                      isSelected || (!effectiveSelectedProvider && index === 0)
                        ? 0
                        : -1
                    }
                    onClick={() => {
                      if (disableSwitch) return;
                      setUserSelectedProvider(option.id);
                    }}
                    aria-checked={isSelected}
                    aria-disabled={disableSwitch}
                    className={`flex flex-col items-start gap-2 rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      isSelected
                        ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/30"
                        : `border-border ${disableSwitch ? "" : "hover:border-blue-400"}`
                    } ${disableSwitch ? "cursor-default" : "cursor-pointer"}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">
                        {option.name}
                      </span>
                      {option.experimental && (
                        <DyadBadge color="amber">
                          {t("integrations.databaseSetup.experimental")}
                        </DyadBadge>
                      )}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          ipc.system.openExternalUrl(option.url);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            ipc.system.openExternalUrl(option.url);
                          }
                        }}
                        tabIndex={0}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                        role="link"
                        aria-label={`Visit ${option.name} website`}
                      >
                        <ExternalLink size={12} />
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {isInteractive && (
              <Button
                onClick={handleNextClick}
                disabled={!effectiveSelectedProvider}
                className="w-full mt-3"
                size="sm"
              >
                {t("integrations.databaseSetup.next")}
              </Button>
            )}
          </>
        )}
      </div>
    </DyadCard>
  );
};
