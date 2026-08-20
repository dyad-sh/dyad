import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DeepLinkProvider } from "../contexts/DeepLinkContext";
import { Toaster } from "sonner";
import { TitleBar } from "./TitleBar";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAppOutputSubscription } from "@/hooks/useRunApp";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_ZOOM_LEVEL } from "@/lib/schemas";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import { usePlanEvents } from "@/hooks/usePlanEvents";
import { useIntegrationEvents } from "@/hooks/useIntegrationEvents";
import { useAppBlueprintEvents } from "@/hooks/useAppBlueprintEvents";
import { useTestRunEvents } from "@/hooks/useTestRunEvents";
import { useZoomShortcuts } from "@/hooks/useZoomShortcuts";
import { useChatStreamRuntime } from "@/hooks/useChatStream";
import { useBackgroundAutoReview } from "@/hooks/subagentReviewOrchestration";
import { useReopenClosedTab } from "@/hooks/useReopenClosedTab";
import { VersionPreviewProvider } from "@/version_preview/VersionPreviewProvider";
import {
  AppRunRemoteProvider,
  useAppRunRemoteManager,
} from "@/app_run/AppRunRemoteProvider";
import { PlanHandoffProvider } from "@/plan_handoff/PlanHandoffProvider";
import i18n from "@/i18n";
import { LanguageSchema } from "@/lib/schemas";
import { useShortcut } from "@/hooks/useShortcut";
import { useIsMac } from "@/hooks/useChatModeToggle";
import { ReleaseNotesDialog } from "@/components/ReleaseNotesDialog";
import { ForceCloseDialog } from "@/components/ForceCloseDialog";
import { SubscriptionStatusBanner } from "@/components/SubscriptionStatusBanner";
import { ImageGenerationProvider } from "@/image_generation/ImageGenerationProvider";
import {
  FirstPromptProvider,
  type FirstPromptChatStream,
} from "@/first_prompt/FirstPromptProvider";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import { useStreamChat } from "@/hooks/useStreamChat";
import { PreviewIframeProvider } from "@/preview_iframe/PreviewIframeProvider";
import { GithubOpsProvider } from "@/github_ops/GithubOpsProvider";
import {
  ScreenshotProvider,
  useScreenshotManager,
} from "@/screenshot/ScreenshotProvider";
import { useSyncDefaultChatMode } from "@/hooks/useSyncDefaultChatMode";
import { PreviewErrorFacadeProvider } from "@/app_wiring/preview_error_facade";
import { usePreviewErrorFacade } from "@/app_wiring/preview_error_facade";
import { PackageManagerWarningProvider } from "@/package_manager_warnings/PackageManagerWarningProvider";
import { CommandPalette } from "@/components/CommandPalette";
import {
  announceCommandPaletteOpening,
  CHAT_SCOPE_PREFIX,
  hasBlockingAlertDialogOpen,
  isTerminalShortcutTarget,
} from "@/lib/commandPalette";

export default function RootLayout({ children }: { children: ReactNode }) {
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { settings } = useSettings();
  const firstPromptChatStream = useMemo<FirstPromptChatStream>(
    () => ({
      submit: (request) =>
        streamMessage({
          ...request,
          attachments: [...request.attachments],
        }),
    }),
    [streamMessage],
  );
  return (
    <PreviewErrorFacadeProvider>
      <PackageManagerWarningProvider>
        <AppRunRemoteProvider>
          <ScreenshotProvider>
            <GithubOpsProvider>
              <ImageGenerationProvider>
                <FirstPromptProvider
                  chatStream={firstPromptChatStream}
                  clock={systemClock}
                  idSource={uuidIdSource}
                  settleDelayMs={settings?.isTestMode ? 0 : 2_000}
                >
                  <PlanHandoffProvider>
                    <RootLayoutContent>{children}</RootLayoutContent>
                  </PlanHandoffProvider>
                </FirstPromptProvider>
              </ImageGenerationProvider>
            </GithubOpsProvider>
          </ScreenshotProvider>
        </AppRunRemoteProvider>
      </PackageManagerWarningProvider>
    </PreviewErrorFacadeProvider>
  );
}

function RootLayoutContent({ children }: { children: ReactNode }) {
  const appRunManager = useAppRunRemoteManager();
  const previewErrors = usePreviewErrorFacade();
  const screenshotManager = useScreenshotManager();
  // Subscribe to app output events once at the root level to avoid duplicates
  useAppOutputSubscription();
  useEffect(
    () =>
      appRunManager.subscribeRunStateChanged((appId, state) => {
        if (state.operationError) {
          previewErrors.setAppError(appId, state.operationError.message);
        } else {
          previewErrors.clearAppError(appId);
        }
      }),
    [appRunManager, previewErrors],
  );
  const { settings } = useSettings();
  const setSelectedComponentsPreview = useSetAtom(
    selectedComponentsPreviewAtom,
  );
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  useSyncDefaultChatMode();

  const openCommandPalette = useCallback((query: string = "") => {
    if (hasBlockingAlertDialogOpen()) return;
    announceCommandPaletteOpening();
    setCommandPaletteQuery(query);
    setIsCommandPaletteOpen(true);
  }, []);

  const handleCommandPaletteOpenChange = useCallback((open: boolean) => {
    setIsCommandPaletteOpen(open);
    if (!open) setCommandPaletteQuery("");
  }, []);

  useEffect(() => {
    const handleCommandPaletteShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        (event.key.toLowerCase() !== "k" && event.key.toLowerCase() !== "p")
      ) {
        return;
      }

      if (
        event.ctrlKey &&
        !event.metaKey &&
        isTerminalShortcutTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      if (event.repeat) return;
      openCommandPalette(
        event.key.toLowerCase() === "k" ? CHAT_SCOPE_PREFIX : "",
      );
    };

    window.addEventListener("keydown", handleCommandPaletteShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleCommandPaletteShortcut, true);
  }, [openCommandPalette]);

  // Initialize plan events listener
  usePlanEvents();
  useIntegrationEvents();

  // Initialize app blueprint events listener
  useAppBlueprintEvents();

  // Consume agent test-run lifecycle events at the root so the terminal
  // "finished" event is never dropped by a TestsPanel unmount mid-run.
  useTestRunEvents();

  // Zoom keyboard shortcuts (Ctrl/Cmd + =/- /0)
  useZoomShortcuts();

  // Reopen closed tab shortcut (Ctrl/Cmd + Shift + T)
  const { reopenClosedTab } = useReopenClosedTab();
  const isMac = useIsMac();
  useShortcut(
    "t",
    { ctrl: !isMac, meta: isMac, shift: true },
    reopenClosedTab,
    true,
  );

  // Wire the chat stream machine's runtime (side-effect adapter). Streams
  // and queued-message dispatch keep running globally, even when the chat
  // page is closed.
  useChatStreamRuntime({
    requestPreviewReload: appRunManager.requestManualReload,
    requestCapture: screenshotManager.requestCapture,
  });
  useBackgroundAutoReview();

  // Persist queued messages to disk and hydrate them on startup, so queued
  // prompts survive app restarts / crashes.

  useEffect(() => {
    const zoomLevel = settings?.zoomLevel ?? DEFAULT_ZOOM_LEVEL;
    const zoomFactor = Number(zoomLevel) / 100;

    const electronApi = (
      window as Window & {
        electron?: {
          webFrame?: {
            setZoomFactor: (factor: number) => void;
          };
        };
      }
    ).electron;

    if (electronApi?.webFrame?.setZoomFactor) {
      electronApi.webFrame.setZoomFactor(zoomFactor);

      return () => {
        electronApi.webFrame?.setZoomFactor(Number(DEFAULT_ZOOM_LEVEL) / 100);
      };
    }

    return () => {};
  }, [settings?.zoomLevel]);

  // Sync i18n language with persisted user setting
  useEffect(() => {
    const parsed = LanguageSchema.safeParse(settings?.language);
    const language = parsed.success ? parsed.data : "en";
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [settings?.language]);

  useEffect(() => {
    setSelectedComponentsPreview([]);
  }, [selectedAppId, setSelectedComponentsPreview]);

  return (
    <>
      <VersionPreviewProvider>
        <PreviewIframeProvider appRunState={appRunManager}>
          <ThemeProvider>
            <DeepLinkProvider>
              <SidebarProvider defaultOpen={false}>
                <TitleBar onOpenCommandPalette={() => openCommandPalette("")} />
                <AppSidebar />
                <div className="flex h-screenish min-w-0 flex-1 flex-col overflow-hidden mt-[var(--layout-title-bar-offset)] border-l border-border bg-background">
                  <SubscriptionStatusBanner />
                  <div
                    id="layout-main-content-container"
                    className="flex min-h-0 w-full flex-1 overflow-x-hidden"
                  >
                    {children}
                  </div>
                </div>
                <Toaster
                  richColors
                  expand
                  duration={settings?.isTestMode ? 500 : undefined}
                />
                <ReleaseNotesDialog />
                <ForceCloseDialog />
                <CommandPalette
                  open={isCommandPaletteOpen}
                  query={commandPaletteQuery}
                  onOpenChange={handleCommandPaletteOpenChange}
                  onQueryChange={setCommandPaletteQuery}
                />
              </SidebarProvider>
            </DeepLinkProvider>
          </ThemeProvider>
        </PreviewIframeProvider>
      </VersionPreviewProvider>
    </>
  );
}
