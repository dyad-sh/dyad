import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { homeChatInputValueAtom } from "../atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { generateCuteAppName } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSettings } from "@/hooks/useSettings";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useState, useEffect, useRef, useMemo } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { HomeChatInput } from "@/components/chat/HomeChatInput";
import { usePostHog } from "posthog-js/react";
import { PrivacyBanner } from "@/components/TelemetryBanner";
import {
  HomeQuickActions,
  pickHomeQuickActionPrompts,
} from "@/components/home/HomeQuickActions";
import { HomeGreeting } from "@/components/home/HomeGreeting";
import { JarvisBackground } from "@/components/home/JarvisBackground";
import { BuildingPreviewScreen } from "@/components/preview_panel/BuildingPreviewScreen";
import { useAppVersion } from "@/hooks/useAppVersion";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { showError } from "@/lib/toast";
import { invalidateAppQuery } from "@/hooks/useLoadApp";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { ForceCloseDialog } from "@/components/ForceCloseDialog";
import { useSelectChat } from "@/hooks/useSelectChat";
import type { FileAttachment } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { NEON_TEMPLATE_IDS } from "@/shared/templates";
import { neonTemplateHook } from "@/client_logic/template_hook";
import { getEffectiveDefaultChatMode } from "@/lib/schemas";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { useInitialChatMode } from "@/hooks/useInitialChatMode";

// Track whether we've already checked release notes this session (module-scoped
// so it persists across component unmount/remount cycles).
let hasCheckedReleaseNotes = false;

// Adding an export for attachments
export interface HomeSubmitOptions {
  attachments?: FileAttachment[];
  selectedApp?: ListedApp;
}

function JarvisStatusBar() {
  const metrics = useMemo(
    () => ({
      cpu: Math.round(12 + Math.random() * 15),
      mem: Math.round(28 + Math.random() * 20),
    }),
    [],
  );

  return (
    <div
      className="jarvis-status-bar pointer-events-none mt-4 hidden w-full max-w-2xl select-none items-center justify-between sm:flex"
      aria-hidden
    >
      <div className="flex items-center gap-3">
        <span className="jarvis-status-dot" />
        <span className="jarvis-status-text">SYSTEM ONLINE</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="jarvis-status-metric">
          CPU: <span className="jarvis-status-value">{metrics.cpu}%</span>
        </span>
        <span className="jarvis-status-metric">
          MEM: <span className="jarvis-status-value">{metrics.mem}%</span>
        </span>
        <span className="jarvis-status-metric">
          NET: <span className="jarvis-status-value">OPTIMAL</span>
        </span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { t } = useTranslation("home");
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const navigate = useNavigate();
  // Desktop Mode renders this route component directly inside a window. Use
  // non-strict search so the studio stays mounted when another desktop app
  // changes the shared router location.
  const search = useSearch({ strict: false });
  const { refreshApps } = useLoadApps();
  const { settings, updateSettings, envVars } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const initialChatMode = useInitialChatMode();

  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const { selectChat } = useSelectChat();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"new" | "existing">("new");
  const [forceCloseDialogOpen, setForceCloseDialogOpen] = useState(false);
  const [performanceData, setPerformanceData] = useState<any>(undefined);
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const posthog = usePostHog();
  const appVersion = useAppVersion();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState("");
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  // Listen for force-close events
  useEffect(() => {
    const unsubscribe = ipc.events.system.onForceCloseDetected((data) => {
      setPerformanceData(data.performanceData);
      setForceCloseDialogOpen(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const updateLastVersionLaunched = async () => {
      if (
        hasCheckedReleaseNotes ||
        !appVersion ||
        !settings ||
        settings.lastShownReleaseNotesVersion === appVersion
      ) {
        return;
      }
      hasCheckedReleaseNotes = true;

      const shouldShowReleaseNotes = !!settings.lastShownReleaseNotesVersion;
      await updateSettings({
        lastShownReleaseNotesVersion: appVersion,
      });
      // It feels spammy to show release notes if it's
      // the users very first time.
      if (!shouldShowReleaseNotes) {
        return;
      }

      try {
        const result = await ipc.system.doesReleaseNoteExist({
          version: appVersion,
        });

        if (result.exists && result.url) {
          setReleaseUrl(result.url + "?hideHeader=true&theme=" + theme);
          setReleaseNotesOpen(true);
        }
      } catch (err) {
        console.warn(
          "Unable to check if release note exists for: " + appVersion,
          err,
        );
      }
    };
    updateLastVersionLaunched();
  }, [appVersion, settings, updateSettings, theme]);

  // Get the appId from search params
  const appId = search.appId ? Number(search.appId) : null;

  const [quickActionPrompts, setQuickActionPrompts] = useState(() =>
    pickHomeQuickActionPrompts(5),
  );

  // Redirect to app details page if appId is present. Use `replace` so the
  // intermediate `/?appId=…` entry doesn't sit in history and trap the back
  // button on app-details in a redirect loop.
  useEffect(() => {
    if (appId) {
      navigate({ to: "/app-details", search: { appId }, replace: true });
    }
  }, [appId, navigate]);

  // Apply default chat mode when navigating to home page
  // Wait for quota status to load to avoid race condition where we default to Basic Agent
  // before knowing if quota is actually exceeded
  const hasAppliedDefaultChatMode = useRef(false);
  useEffect(() => {
    if (settings && !hasAppliedDefaultChatMode.current && !isQuotaLoading) {
      hasAppliedDefaultChatMode.current = true;
      const effectiveDefaultMode = getEffectiveDefaultChatMode(
        settings,
        envVars,
        !isQuotaExceeded,
      );
      if (settings.selectedChatMode !== effectiveDefaultMode) {
        updateSettings({ selectedChatMode: effectiveDefaultMode });
      }
    }
  }, [settings, updateSettings, isQuotaExceeded, isQuotaLoading, envVars]);

  const handleSubmit = async (options?: HomeSubmitOptions) => {
    const attachments = options?.attachments || [];
    const selectedApp = options?.selectedApp;

    if (!inputValue.trim() && attachments.length === 0) return;

    try {
      setLoadingMode(selectedApp ? "existing" : "new");
      setIsLoading(true);

      let chatId: number;
      let appId: number;
      if (selectedApp) {
        // Existing app flow: create a new chat in the selected app
        chatId = await ipc.chat.createChat({
          appId: selectedApp.id,
          initialChatMode,
        });
        appId = selectedApp.id;
      } else {
        // New app flow (default behavior)
        const result = await ipc.app.createApp({
          name: generateCuteAppName(),
          initialChatMode,
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

      // Stream the message with attachments
      streamMessage({
        prompt: inputValue,
        chatId,
        appId,
        attachments,
        requestedChatMode: initialChatMode,
      });
      await new Promise((resolve) =>
        setTimeout(resolve, settings?.isTestMode ? 0 : 2000),
      );

      setInputValue("");
      setIsPreviewOpen(false);
      await refreshApps();
      await invalidateAppQuery(queryClient, { appId });
      // Invalidate chats so ChatTabs picks up the new chat immediately.
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      posthog.capture("home:chat-submit", { existingApp: !!selectedApp });
      // Select newly created first chat so it appears first in tabs.
      selectChat({ chatId, appId });
    } catch (error) {
      console.error("Failed to create chat:", error);
      showError(
        t(selectedApp ? "failedCreateChat" : "failedCreateApp", {
          error: (error as any).toString(),
        }),
      );
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <BuildingPreviewScreen
        variant="fullscreen"
        phase={loadingMode === "existing" ? "starting" : "building"}
      />
    );
  }

  // Main Home Page Content
  return (
    <div className="home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <JarvisBackground className="z-0" />
      <div className="home-jarvis-scroll relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto scrollbar-on-hover">
        {/* HUD corner overlays */}
        <div
          className="pointer-events-none absolute inset-4 z-20 hidden sm:block"
          aria-hidden
        >
          <div className="jarvis-hud-corner jarvis-hud-corner--tl absolute top-0 left-0" />
          <div className="jarvis-hud-corner jarvis-hud-corner--tr absolute top-0 right-0" />
          <div className="jarvis-hud-corner jarvis-hud-corner--bl absolute bottom-0 left-0" />
          <div className="jarvis-hud-corner jarvis-hud-corner--br absolute bottom-0 right-0" />
        </div>

        <div
          className="home-jarvis-content mx-auto flex w-full min-h-full max-w-3xl flex-col items-center px-4 py-6 sm:px-8 sm:py-8"
          data-reset-scroll-on-route
        >
          <ForceCloseDialog
            isOpen={forceCloseDialogOpen}
            onClose={() => setForceCloseDialogOpen(false)}
            performanceData={performanceData}
          />
          <div className="home-jarvis-prompt flex w-full flex-1 flex-col items-center justify-center gap-6 sm:gap-8">
            <HomeGreeting />

            <div className="w-full max-w-2xl shrink-0">
              <HomeChatInput onSubmit={handleSubmit} />
            </div>
          </div>

          <div className="home-jarvis-below flex w-full shrink-0 flex-col items-center gap-6 pt-2">
            <HomeQuickActions
              prompts={quickActionPrompts}
              onSelect={(label) => setInputValue(t("buildMeA", { label }))}
              onRefresh={() =>
                setQuickActionPrompts(pickHomeQuickActionPrompts(5))
              }
            />

            <PrivacyBanner />
          </div>

          {/* Bottom HUD status bar */}
          <JarvisStatusBar />

          {/* Release Notes Dialog */}
          <Dialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen}>
            <DialogContent className="max-w-4xl bg-(--docs-bg) pr-0 pt-4 pl-4 gap-1">
              <DialogHeader>
                <DialogTitle>
                  {t("whatsNew", { version: appVersion })}
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-10 top-2 focus-visible:ring-0 focus-visible:ring-offset-0"
                  onClick={() =>
                    window.open(
                      releaseUrl.replace("?hideHeader=true&theme=" + theme, ""),
                      "_blank",
                    )
                  }
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </DialogHeader>
              <div className="overflow-auto h-[70vh] flex flex-col ">
                {releaseUrl && (
                  <div className="flex-1">
                    <iframe
                      src={releaseUrl}
                      className="w-full h-full border-0 rounded-lg"
                      title={t("releaseNotesTitle", { version: appVersion })}
                    />
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
