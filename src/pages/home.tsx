import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  attachmentsAtom,
  hasManuallySelectedChatModeAtom,
  homeChatInputValueAtom,
  homeSelectedAppAtom,
  pendingFirstPromptAtom,
} from "../atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { generateCuteAppName } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSettings } from "@/hooks/useSettings";
import { SetupBanner } from "@/components/SetupBanner";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { HomeChatInput } from "@/components/chat/HomeChatInput";
import { usePostHog } from "posthog-js/react";
import { PrivacyBanner } from "@/components/TelemetryBanner";
import { INSPIRATION_PROMPTS } from "@/prompts/inspiration_prompts";

import { ImportAppButton } from "@/components/ImportAppButton";
import { showError } from "@/lib/toast";
import { invalidateAppQuery } from "@/hooks/useLoadApp";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useSelectChat } from "@/hooks/useSelectChat";
import { FeaturedAppShowcase } from "@/components/FeaturedAppShowcase";

import type { FileAttachment } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { NEON_TEMPLATE_IDS } from "@/shared/templates";
import { neonTemplateHook } from "@/client_logic/template_hook";
import { getEffectiveDefaultChatMode, type ChatMode } from "@/lib/schemas";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  isFreeProBuildModeCombination,
} from "@/lib/freeProModel";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { useInitialChatMode } from "@/hooks/useInitialChatMode";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useOpenPreviewIfSetupRequired } from "@/hooks/useOpenPreviewIfSetupRequired";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, X, Zap } from "lucide-react";

// Adding an export for attachments
export interface HomeSubmitOptions {
  attachments?: FileAttachment[];
  selectedApp?: ListedApp;
}

export default function HomePage() {
  const { t } = useTranslation("home");
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const [pendingSelectedApp, setPendingSelectedApp] =
    useAtom(homeSelectedAppAtom);
  const [pendingAttachments, setPendingAttachments] = useAtom(attachmentsAtom);
  const shouldResumeFirstPrompt = useAtomValue(pendingFirstPromptAtom);
  const setShouldResumeFirstPrompt = useSetAtom(pendingFirstPromptAtom);
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const { refreshApps } = useLoadApps();
  const { settings, updateSettings, envVars } = useSettings();
  const { isAnyProviderSetup, isLoading: isLoadingLanguageModelProviders } =
    useLanguageModelProviders();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const initialChatMode = useInitialChatMode();
  const homeInitialChatMode = useMemo<ChatMode | undefined>(() => {
    if (!settings || isQuotaLoading) {
      return initialChatMode;
    }

    const effectiveDefaultChatMode = getEffectiveDefaultChatMode(
      settings,
      envVars,
      !isQuotaExceeded,
    );
    if (
      isFreeProBuildModeCombination(
        settings.selectedModel,
        effectiveDefaultChatMode,
      )
    ) {
      return FREE_PRO_MODEL_FALLBACK_CHAT_MODE;
    }
    return effectiveDefaultChatMode;
  }, [envVars, initialChatMode, isQuotaExceeded, isQuotaLoading, settings]);

  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const openPreviewIfSetupRequired = useOpenPreviewIfSetupRequired();
  const { selectChat } = useSelectChat();
  const [isLoading, setIsLoading] = useState(false);
  const [isAiSetupDialogOpen, setIsAiSetupDialogOpen] = useState(false);
  const [isSetupPillDismissed, setIsSetupPillDismissed] = useState(false);
  const [
    shouldOpenAiSetupDialogWhenProvidersLoad,
    setShouldOpenAiSetupDialogWhenProvidersLoad,
  ] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"new" | "existing">("new");
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const posthog = usePostHog();
  const queryClient = useQueryClient();

  // Get the appId from search params
  const appId = search.appId ? Number(search.appId) : null;

  // State for random prompts
  const [randomPrompts, setRandomPrompts] = useState<
    typeof INSPIRATION_PROMPTS
  >([]);

  // Function to get random prompts
  const getRandomPrompts = useCallback(() => {
    const shuffled = [...INSPIRATION_PROMPTS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3);
  }, []);

  // Initialize random prompts
  useEffect(() => {
    setRandomPrompts(getRandomPrompts());
  }, [getRandomPrompts]);

  // Redirect to app details page if appId is present. Use `replace` so the
  // intermediate `/?appId=…` entry doesn't sit in history and trap the back
  // button on app-details in a redirect loop.
  useEffect(() => {
    if (appId) {
      navigate({ to: "/app-details", search: { appId }, replace: true });
    }
  }, [appId, navigate]);

  // Keep the selected chat mode synced to the effective default (which can
  // change as quota/provider state loads) until the user explicitly picks a
  // mode. Wait for quota status to load to avoid race condition where we
  // default to Basic Agent before knowing if quota is actually exceeded.
  const hasManuallySelectedChatMode = useAtomValue(
    hasManuallySelectedChatModeAtom,
  );
  useEffect(() => {
    if (
      !settings ||
      !homeInitialChatMode ||
      isQuotaLoading ||
      hasManuallySelectedChatMode
    ) {
      return;
    }
    if (settings.selectedChatMode !== homeInitialChatMode) {
      updateSettings({ selectedChatMode: homeInitialChatMode });
    }
  }, [
    homeInitialChatMode,
    settings,
    updateSettings,
    isQuotaLoading,
    hasManuallySelectedChatMode,
  ]);

  const openAiSetupDialog = useCallback(() => {
    posthog.capture("home:ai-setup-dialog-open");
    if (inputValue.trim() || pendingAttachments.length > 0) {
      setShouldResumeFirstPrompt(true);
    }
    setIsAiSetupDialogOpen(true);
  }, [
    inputValue,
    pendingAttachments.length,
    posthog,
    setShouldResumeFirstPrompt,
  ]);

  const handleAiSetupDialogOpenChange = useCallback(
    (open: boolean) => {
      setIsAiSetupDialogOpen(open);
      if (!open) {
        setShouldResumeFirstPrompt(false);
      }
    },
    [setShouldResumeFirstPrompt],
  );

  useEffect(() => {
    if (
      !shouldOpenAiSetupDialogWhenProvidersLoad ||
      isLoadingLanguageModelProviders
    ) {
      return;
    }

    setShouldOpenAiSetupDialogWhenProvidersLoad(false);
    if (!isAnyProviderSetup()) {
      openAiSetupDialog();
    }
  }, [
    isAnyProviderSetup,
    isLoadingLanguageModelProviders,
    openAiSetupDialog,
    shouldOpenAiSetupDialogWhenProvidersLoad,
  ]);

  const handleSubmit = useCallback(
    async (options?: HomeSubmitOptions) => {
      const attachments = options?.attachments || [];
      const selectedApp = options?.selectedApp;

      if (!inputValue.trim() && attachments.length === 0) return false;

      if (!isAnyProviderSetup()) {
        if (isLoadingLanguageModelProviders) {
          if (inputValue.trim() || attachments.length > 0) {
            setShouldResumeFirstPrompt(true);
          }
          setShouldOpenAiSetupDialogWhenProvidersLoad(true);
          return false;
        }

        openAiSetupDialog();
        return false;
      }

      try {
        setLoadingMode(selectedApp ? "existing" : "new");
        setIsLoading(true);

        let chatId: number;
        let appId: number;
        if (selectedApp) {
          // Existing app flow: create a new chat in the selected app
          chatId = await ipc.chat.createChat({
            appId: selectedApp.id,
            initialChatMode: homeInitialChatMode,
          });
          appId = selectedApp.id;
        } else {
          // New app flow (default behavior)
          const result = await ipc.app.createApp({
            name: generateCuteAppName(),
            initialChatMode: homeInitialChatMode,
          });
          chatId = result.chatId;
          appId = result.app.id;

          if (
            settings?.selectedTemplateId &&
            NEON_TEMPLATE_IDS.has(settings.selectedTemplateId)
          ) {
            await neonTemplateHook({
              appId: result.app.id,
              appName: result.app.name,
            });
          }

          // Apply selected theme to the new app (if one is set)
          if (settings?.selectedThemeId) {
            await ipc.template.setAppTheme({
              appId: result.app.id,
              themeId: settings.selectedThemeId || null,
            });
          }
        }

        const openedPreviewSetupPromise = openPreviewIfSetupRequired(appId);

        // Stream the message with attachments
        streamMessage({
          prompt: inputValue,
          chatId,
          appId,
          attachments,
          requestedChatMode: homeInitialChatMode,
        });
        // The prompt is committed once streamMessage is dispatched; clearing
        // must happen before the awaits below so a rejection can't leave the
        // already-sent prompt in the box to be resubmitted.
        setInputValue("");
        await new Promise((resolve) =>
          setTimeout(resolve, settings?.isTestMode ? 0 : 2000),
        );
        const openedPreviewSetup = await openedPreviewSetupPromise;

        if (!openedPreviewSetup) {
          setIsPreviewOpen(false);
        }
        await refreshApps();
        await invalidateAppQuery(queryClient, { appId });
        // Invalidate chats so ChatTabs picks up the new chat immediately.
        await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
        posthog.capture("home:chat-submit", { existingApp: !!selectedApp });
        // Select newly created first chat so it appears first in tabs.
        selectChat({ chatId, appId });
        return true;
      } catch (error) {
        console.error("Failed to create chat:", error);
        showError(
          t(selectedApp ? "failedCreateChat" : "failedCreateApp", {
            error: (error as any).toString(),
          }),
        );
        setIsLoading(false);
        return false;
      }
    },
    [
      inputValue,
      homeInitialChatMode,
      isAnyProviderSetup,
      isLoadingLanguageModelProviders,
      navigate,
      openAiSetupDialog,
      openPreviewIfSetupRequired,
      posthog,
      queryClient,
      refreshApps,
      selectChat,
      setInputValue,
      setIsPreviewOpen,
      setShouldResumeFirstPrompt,
      settings,
      streamMessage,
      t,
    ],
  );

  const hasAttemptedAutoResumeRef = useRef(false);
  useEffect(() => {
    if (!shouldResumeFirstPrompt) {
      hasAttemptedAutoResumeRef.current = false;
    }
  }, [shouldResumeFirstPrompt]);

  useEffect(() => {
    if (
      !shouldResumeFirstPrompt ||
      isLoadingLanguageModelProviders ||
      !isAnyProviderSetup() ||
      (!inputValue.trim() && pendingAttachments.length === 0) ||
      isLoading ||
      hasAttemptedAutoResumeRef.current
    ) {
      return;
    }

    hasAttemptedAutoResumeRef.current = true;
    setIsAiSetupDialogOpen(false);
    navigate({ to: "/", search: {}, replace: true });

    void (async () => {
      const didSubmit = await handleSubmit({
        attachments: pendingAttachments,
        selectedApp: pendingSelectedApp ?? undefined,
      });
      // Clear the pending flag even on failure: handleSubmit already surfaces
      // an error toast and the user can retry manually from the input. Leaving
      // the flag set would auto-submit whatever is in the input the next time
      // this page mounts with a provider configured.
      setShouldResumeFirstPrompt(false);
      if (didSubmit) {
        setPendingAttachments([]);
        setPendingSelectedApp(null);
      }
      // Intentionally do not re-arm on failure: handleSubmit already surfaces
      // an error toast, and re-arming would re-fire this effect immediately
      // (inputValue and shouldResumeFirstPrompt are still set), causing an
      // infinite retry loop. The user can retry manually from the input.
    })();
  }, [
    handleSubmit,
    inputValue,
    isAnyProviderSetup,
    isLoading,
    isLoadingLanguageModelProviders,
    navigate,
    pendingAttachments,
    pendingSelectedApp,
    setPendingAttachments,
    setPendingSelectedApp,
    setShouldResumeFirstPrompt,
    shouldResumeFirstPrompt,
  ]);

  // Loading overlay for app creation
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center max-w-3xl m-auto p-8">
        <div className="w-full flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="relative w-24 h-24 mb-8">
            <div className="absolute top-0 left-0 w-full h-full border-8 border-gray-200 dark:border-gray-700 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-8 border-t-primary rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-gray-800 dark:text-gray-200">
            {loadingMode === "existing" ? t("startingChat") : t("buildingApp")}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-center max-w-md mb-8">
            {loadingMode === "existing" ? (
              t("creatingNewChat")
            ) : (
              <>
                {t("settingUp")} <br />
                {t("mightTakeMoment")}
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  // Main Home Page Content
  return (
    <div className="flex min-h-full w-full flex-col pb-28">
      <div className="flex flex-col items-center justify-center max-w-3xl w-full m-auto p-8 relative">
        <div className="w-full">
          <div className="mb-6 text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              What do you want to build?
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Describe your idea. Dyad will turn it into a working app.
            </p>
            <div className="mt-4 flex justify-center">
              <ImportAppButton
                className="px-0 pb-0"
                variant="outline"
                size="sm"
              />
            </div>
          </div>
          <HomeChatInput onSubmit={handleSubmit} />

          {!isSetupPillDismissed &&
            !isLoadingLanguageModelProviders &&
            !isAnyProviderSetup() && (
              <div className="mt-3 flex justify-center">
                <div className="flex items-center gap-0.5 rounded-full border border-primary/25 bg-primary/5 py-0.5 pl-3 pr-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      posthog.capture("home:setup-pill:click");
                      openAiSetupDialog();
                    }}
                    className="flex cursor-pointer items-center gap-1.5 py-1 text-sm font-medium text-primary transition-colors hover:underline"
                  >
                    <Zap aria-hidden="true" className="size-3.5" />
                    Connect AI to build — takes a minute
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => {
                      posthog.capture("home:setup-pill:dismiss");
                      setIsSetupPillDismissed(true);
                    }}
                    className="flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              </div>
            )}

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {randomPrompts.map((item) => (
              <button
                type="button"
                key={item.label}
                onClick={() => setInputValue(item.prompt)}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground"
              >
                <span aria-hidden="true" className="[&_svg]:size-4">
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRandomPrompts(getRandomPrompts())}
              className="group flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className="size-4 transition-transform duration-200 group-hover:rotate-[-25deg]" />
              {t("moreIdeas")}
            </button>
          </div>
        </div>
        <PrivacyBanner />
      </div>
      <FeaturedAppShowcase />
      <Dialog
        open={isAiSetupDialogOpen}
        onOpenChange={handleAiSetupDialogOpenChange}
      >
        <DialogContent className="p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>You're almost ready to build</DialogTitle>
            <DialogDescription>
              Choose how Dyad should access AI before generating your app.
            </DialogDescription>
          </DialogHeader>
          <SetupBanner variant="dialog" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
