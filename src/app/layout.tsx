import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DeepLinkProvider } from "../contexts/DeepLinkContext";
import { Toaster } from "sonner";
import { TitleBar } from "./TitleBar";
import { useEffect, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useRunApp, useAppOutputSubscription } from "@/hooks/useRunApp";
import { useAtomValue, useSetAtom } from "jotai";
import {
  appConsoleEntriesAtom,
  previewModeAtom,
  selectedAppIdAtom,
} from "@/atoms/appAtoms";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_ZOOM_LEVEL } from "@/lib/schemas";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import { usePlanEvents } from "@/hooks/usePlanEvents";
import { useIntegrationEvents } from "@/hooks/useIntegrationEvents";
import { useZoomShortcuts } from "@/hooks/useZoomShortcuts";
import { useQueueProcessor } from "@/hooks/useQueueProcessor";
import { useIntegrationContinuation } from "@/hooks/useIntegrationContinuation";
import { useReopenClosedTab } from "@/hooks/useReopenClosedTab";
import i18n from "@/i18n";
import { LanguageSchema } from "@/lib/schemas";
import { useShortcut } from "@/hooks/useShortcut";
import { useIsMac } from "@/hooks/useChatModeToggle";
import { useStorageAutoSync } from "@/hooks/useStorageAutoSync";
import { ipc } from "@/ipc/types";
import { AgentWorkspaceTabs } from "@/components/AgentWorkspaceTabs";

/** Routes where the main panel scrolls (tall page content). */
export function isScrollableMainRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/settings") ||
    pathname.startsWith("/storage") ||
    pathname.startsWith("/vector") ||
    pathname === "/hub" ||
    pathname.startsWith("/github") ||
    pathname.startsWith("/vercel") ||
    pathname.startsWith("/library")
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isScrollableMain = isScrollableMainRoute(pathname);

  useEffect(() => {
    const main = document.getElementById("layout-main-content-container");
    if (!main) return;

    const frameId = window.requestAnimationFrame(() => {
      main.scrollTop = 0;
      main
        .querySelectorAll<HTMLElement>("[data-reset-scroll-on-route]")
        .forEach((element) => {
          element.scrollTop = 0;
          element.scrollLeft = 0;
        });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [pathname, isScrollableMain]);
  const { refreshAppIframe } = useRunApp();
  // Subscribe to app output events once at the root level to avoid duplicates
  useAppOutputSubscription();
  const previewMode = useAtomValue(previewModeAtom);

  const { settings } = useSettings();
  useStorageAutoSync(settings?.storage);
  const setSelectedComponentsPreview = useSetAtom(
    selectedComponentsPreviewAtom,
  );
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);

  // Initialize plan events listener
  usePlanEvents();
  useIntegrationEvents();

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

  // Process queued messages globally (even when not on chat page)
  useQueueProcessor();

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

  useEffect(() => {
    if (!settings?.appLayoutMode) return;

    void ipc.system
      .setAppLayoutMode({
        mode: settings.appLayoutMode,
      })
      .catch((error) => {
        console.error("Failed to apply app layout mode:", error);
      });
  }, [settings?.appLayoutMode]);

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
    setConsoleEntries([]);
  }, [selectedAppId, setSelectedComponentsPreview, setConsoleEntries]);

  return (
    <>
      <ThemeProvider>
        <DeepLinkProvider>
          <SidebarProvider defaultOpen={false}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <TitleBar />
              <div className="flex min-h-0 flex-1 overflow-hidden pt-[var(--layout-title-bar-offset)]">
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  <AppSidebar />
                  <div
                    id="layout-main-content-container"
                    className={cn(
                      "no-app-region-drag flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden border-l border-border bg-background",
                      isScrollableMain ? "overflow-y-auto" : "overflow-hidden",
                    )}
                  >
                    <AgentWorkspaceTabs />
                    <div
                      className={cn(
                        "layout-route-outlet flex w-full min-w-0 flex-1 flex-col",
                        isScrollableMain
                          ? "min-h-0"
                          : "min-h-0 overflow-hidden",
                      )}
                    >
                      {children}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <Toaster
              richColors
              duration={settings?.isTestMode ? 500 : undefined}
            />
          </SidebarProvider>
        </DeepLinkProvider>
      </ThemeProvider>
    </>
  );
}
