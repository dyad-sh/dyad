import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DeepLinkProvider } from "../contexts/DeepLinkContext";
import { Toaster } from "sonner";
import { TitleBar } from "./TitleBar";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { chatInputValueAtom } from "@/atoms/chatAtoms";
import { usePlanEvents } from "@/hooks/usePlanEvents";
import { useZoomShortcuts } from "@/hooks/useZoomShortcuts";
import i18n from "@/i18n";
import { LanguageSchema } from "@/lib/schemas";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function RootLayout({ children }: { children: ReactNode }) {
  const { refreshAppIframe } = useRunApp();
  // Subscribe to app output events once at the root level to avoid duplicates
  useAppOutputSubscription();
  const previewMode = useAtomValue(previewModeAtom);
  const { settings } = useSettings();
  const setSelectedComponentsPreview = useSetAtom(
    selectedComponentsPreviewAtom,
  );
  const setChatInput = useSetAtom(chatInputValueAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);

  // Initialize plan events listener
  usePlanEvents();

  // Zoom keyboard shortcuts (Ctrl/Cmd + =/- /0)
  useZoomShortcuts();

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
    setChatInput("");
    setSelectedComponentsPreview([]);
    setConsoleEntries([]);
  }, [selectedAppId]);

  return (
    <>
      <ThemeProvider>
        <DeepLinkProvider>
          <SidebarProvider>
            <TitleBar />
            <FloatingAppButton />
            <AppSidebar />
            <div
              id="layout-main-content-container"
              className="flex h-screenish w-full overflow-x-hidden mt-12 mb-4 mr-4 border-t border-l border-border rounded-lg bg-background"
            >
              {children}
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

function FloatingAppButton() {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { state: sidebarState } = useSidebar();
  const { apps } = useLoadApps();
  const { navigate } = useRouter();

  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const isAppRoute =
    pathname === "/" ||
    pathname === "/chat" ||
    pathname.startsWith("/app-details");

  const selectedApp = apps.find((app) => app.id === selectedAppId);
  const displayText = selectedApp
    ? `App: ${selectedApp.name}`
    : "(no app selected)";
  const inSidebar = sidebarState === "expanded" && selectedApp != null;

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const prevInSidebar = useRef(inSidebar);
  // Only animate when leaving the sidebar (going to title bar)
  const [canAnimate, setCanAnimate] = useState(false);

  useEffect(() => {
    if (prevInSidebar.current && !inSidebar) {
      // Leaving sidebar → title bar: animate
      setCanAnimate(true);
    } else {
      // All other transitions: no animation, reset position to avoid flash
      setCanAnimate(false);
      setPos(null);
    }
    prevInSidebar.current = inSidebar;
  }, [inSidebar]);

  const measure = useCallback(() => {
    const anchorKey = inSidebar ? "sidebar" : "titlebar";
    const anchor = document.querySelector(
      `[data-floating-app-anchor="${anchorKey}"]`,
    );
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setPos({ top: rect.top, left: rect.left });
    }
  }, [inSidebar]);

  useEffect(() => {
    const raf = requestAnimationFrame(measure);

    // Re-measure after sidebar transition settles
    const timeout = setTimeout(measure, 220);

    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      window.removeEventListener("resize", measure);
    };
  }, [inSidebar, sidebarState, measure]);

  if (!pos || !isAppRoute) return null;

  return (
    <Button
      data-testid="title-bar-app-name-button"
      variant="outline"
      size="sm"
      className={cn(
        "fixed z-50 no-app-region-drag text-xs max-w-38 truncate font-medium",
        canAnimate && "transition-[top,left] duration-150 ease-in-out",
        selectedApp ? "cursor-pointer" : "",
      )}
      style={{ top: pos.top, left: pos.left }}
      onClick={() => {
        if (selectedApp) {
          navigate({ to: "/app-details", search: { appId: selectedApp.id } });
        }
      }}
    >
      {displayText}
    </Button>
  );
}
