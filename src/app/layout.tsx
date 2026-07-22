import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DeepLinkProvider } from "../contexts/DeepLinkContext";
import { Toaster } from "sonner";
import { TitleBar } from "./TitleBar";
import { useEffect, type ReactNode } from "react";
import { useRunApp, useAppOutputSubscription } from "@/hooks/useRunApp";
import { useAtomValue, useSetAtom } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_ZOOM_LEVEL } from "@/lib/schemas";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import { usePlanEvents } from "@/hooks/usePlanEvents";
import { useIntegrationEvents } from "@/hooks/useIntegrationEvents";
import { useAppBlueprintEvents } from "@/hooks/useAppBlueprintEvents";
import { useTestRunEvents } from "@/hooks/useTestRunEvents";
import { useZoomShortcuts } from "@/hooks/useZoomShortcuts";
import { useChatStreamRuntime } from "@/hooks/useChatStream";
import { useQueuePersistence } from "@/hooks/useQueuePersistence";
import { useIntegrationContinuation } from "@/hooks/useIntegrationContinuation";
import { useReopenClosedTab } from "@/hooks/useReopenClosedTab";
import { VersionPreviewProvider } from "@/version_preview/VersionPreviewProvider";
import { AppRunProvider } from "@/app_run/AppRunProvider";
import { PlanHandoffProvider } from "@/plan_handoff/PlanHandoffProvider";
import i18n from "@/i18n";
import { LanguageSchema } from "@/lib/schemas";
import { useShortcut } from "@/hooks/useShortcut";
import { useIsMac } from "@/hooks/useChatModeToggle";
import { ReleaseNotesDialog } from "@/components/ReleaseNotesDialog";
import { ForceCloseDialog } from "@/components/ForceCloseDialog";
import { SubscriptionStatusBanner } from "@/components/SubscriptionStatusBanner";
import { ensureController as ensureChatStreamController } from "@/chat_stream/registry";

const planHandoffChatStream = {
  submit: (request: {
    chatId: number;
    prompt: string;
    selectedComponents: [];
  }) =>
    ensureChatStreamController(request.chatId).send({
      type: "submit",
      request,
    }),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <AppRunProvider>
      <PlanHandoffProvider chatStream={planHandoffChatStream}>
        <RootLayoutContent>{children}</RootLayoutContent>
      </PlanHandoffProvider>
    </AppRunProvider>
  );
}

function RootLayoutContent({ children }: { children: ReactNode }) {
  const { refreshAppIframe } = useRunApp();
  // Subscribe to app output events once at the root level to avoid duplicates
  useAppOutputSubscription();
  const previewMode = useAtomValue(previewModeAtom);
  const { settings } = useSettings();
  const setSelectedComponentsPreview = useSetAtom(
    selectedComponentsPreviewAtom,
  );
  const selectedAppId = useAtomValue(selectedAppIdAtom);

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
  useChatStreamRuntime();

  // Persist queued messages to disk and hydrate them on startup, so queued
  // prompts survive app restarts / crashes.
  useQueuePersistence();

  // Auto-send integration continuation messages and clean up stale integration
  // state at the root level — keeps the dispatch alive even if the in-chat
  // card unmounts (e.g. virtualized scroll-out).
  useIntegrationContinuation();

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

  // Global keyboard listener for refresh events
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+R (Windows/Linux) or Cmd+R (macOS)
      if (event.key === "r" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault(); // Prevent default browser refresh
        if (previewMode === "preview") {
          refreshAppIframe(); // Use our custom refresh function instead
        }
      }
    };

    // Add event listener to document
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup function to remove event listener
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [refreshAppIframe, previewMode]);

  useEffect(() => {
    setSelectedComponentsPreview([]);
  }, [selectedAppId, setSelectedComponentsPreview]);

  return (
    <>
      <VersionPreviewProvider>
        <ThemeProvider>
          <DeepLinkProvider>
            <SidebarProvider defaultOpen={false}>
              <TitleBar />
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
            </SidebarProvider>
          </DeepLinkProvider>
        </ThemeProvider>
      </VersionPreviewProvider>
    </>
  );
}
