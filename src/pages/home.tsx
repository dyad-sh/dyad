import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import {
  attachmentsAtom,
  hasManuallySelectedChatModeAtom,
  homeChatInputValueAtom,
  homeSelectedAppAtom,
} from "../atoms/chatAtoms";
import { useSettings } from "@/hooks/useSettings";
import { useState, useEffect, useCallback, useMemo } from "react";
import { HomeChatInput } from "@/components/chat/HomeChatInput";
import { usePostHog } from "posthog-js/react";
import { PrivacyBanner } from "@/components/TelemetryBanner";
import { INSPIRATION_PROMPTS } from "@/prompts/inspiration_prompts";

import { ImportAppButton } from "@/components/ImportAppButton";
import { FeaturedAppShowcase } from "@/components/FeaturedAppShowcase";

import type { FileAttachment } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { hasDyadProKey, type ChatMode } from "@/lib/schemas";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  isFreeProBuildModeCombination,
} from "@/lib/freeProModel";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { useInitialChatMode } from "@/hooks/useInitialChatMode";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { RefreshCw, Zap } from "lucide-react";
import { useFirstPromptSend } from "@/first_prompt/FirstPromptProvider";
import { firstPromptSagaAtom } from "@/first_prompt/projection";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";

// Adding an export for attachments
export interface HomeSubmitOptions {
  attachments?: FileAttachment[];
  selectedApp?: ListedApp;
}

export default function HomePage() {
  const { t } = useTranslation("home");
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const selectedApp = useAtomValue(homeSelectedAppAtom);
  const attachments = useAtomValue(attachmentsAtom);
  const firstPromptSaga = useAtomValue(firstPromptSagaAtom);
  const sendFirstPrompt = useFirstPromptSend();
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const {
    settings,
    updateSettings,
    envVars,
    loading: isSettingsLoading,
  } = useSettings();
  const { isAnyProviderSetup, isLoading: isLoadingLanguageModelProviders } =
    useLanguageModelProviders();
  const hasDyadProApiKey = settings ? hasDyadProKey(settings) : false;
  const hasConfiguredAiProvider =
    !isLoadingLanguageModelProviders && isAnyProviderSetup();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const initialChatMode = useInitialChatMode();
  const homeInitialChatMode = useMemo<ChatMode | undefined>(() => {
    if (!settings || isQuotaLoading) {
      return initialChatMode;
    }

    return getHomeDefaultChatMode(settings, envVars, !isQuotaExceeded);
  }, [envVars, initialChatMode, isQuotaExceeded, isQuotaLoading, settings]);

  const posthog = usePostHog();

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

  // Honor a manually picked mode (e.g. "plan") on submit; otherwise fall back
  // to the effective default so it still tracks provider/quota state. Apply the
  // Free Pro fallback for an invalid build-mode + free-pro-model combination.
  const homeSubmitChatMode = useMemo<ChatMode | undefined>(() => {
    const selected =
      hasManuallySelectedChatMode && settings?.selectedChatMode
        ? settings.selectedChatMode
        : homeInitialChatMode;
    if (
      settings &&
      isFreeProBuildModeCombination(settings.selectedModel, selected)
    ) {
      return FREE_PRO_MODEL_FALLBACK_CHAT_MODE;
    }
    return selected;
  }, [settings, homeInitialChatMode, hasManuallySelectedChatMode]);

  const handleSubmit = useCallback(
    (options?: HomeSubmitOptions) => {
      const submittedAttachments = options?.attachments ?? [];
      if (!inputValue.trim() && submittedAttachments.length === 0) return false;
      return sendFirstPrompt({
        type: "SUBMIT",
        payload: {
          prompt: inputValue,
          attachments: submittedAttachments,
          selectedApp: options?.selectedApp,
          chatMode: homeSubmitChatMode,
          isChatModeExplicit: hasManuallySelectedChatMode,
        },
      });
    },
    [
      hasManuallySelectedChatMode,
      homeSubmitChatMode,
      inputValue,
      sendFirstPrompt,
    ],
  );

  const isLoading = [
    "creating",
    "postCreate",
    "dispatching",
    "navigating",
  ].includes(firstPromptSaga.phase);

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
            {firstPromptSaga.isExistingAppSubmission
              ? t("startingChat")
              : t("buildingApp")}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-center max-w-md mb-8">
            {firstPromptSaga.isExistingAppSubmission ? (
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

          {!isSettingsLoading &&
            !isLoadingLanguageModelProviders &&
            !hasDyadProApiKey && (
              <div className="-mt-2 flex justify-end px-4">
                <button
                  type="button"
                  onClick={() => {
                    posthog.capture("home:setup-pill:click");
                    sendFirstPrompt({
                      type: "ARM_FOR_SETUP",
                      payload: {
                        prompt: inputValue,
                        attachments,
                        selectedApp: selectedApp ?? undefined,
                        chatMode: homeSubmitChatMode,
                        isChatModeExplicit: hasManuallySelectedChatMode,
                      },
                    });
                  }}
                  className={
                    hasConfiguredAiProvider
                      ? "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground hover:underline"
                      : "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 hover:underline"
                  }
                >
                  <Zap aria-hidden="true" className="size-3.5" />
                  {hasConfiguredAiProvider
                    ? "Manage AI setup"
                    : "Connect AI to build — takes a minute"}
                </button>
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
    </div>
  );
}
