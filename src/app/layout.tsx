import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DeepLinkProvider } from "../contexts/DeepLinkContext";
import { Toaster } from "sonner";
import { TitleBar } from "./TitleBar";
import { useEffect, type ReactNode } from "react";
import { useRunApp } from "@/hooks/useRunApp";
import { useAtomValue } from "jotai";
import { previewModeAtom } from "@/atoms/appAtoms";
import { useSettings } from "@/hooks/useSettings";
import type { WorkspaceZoomLevel } from "@/lib/schemas";

const DEFAULT_WORKSPACE_ZOOM_LEVEL: WorkspaceZoomLevel = "100";
const WORKSPACE_ZOOM_FACTORS: Record<WorkspaceZoomLevel, number> = {
  "90": 0.9,
  "100": 1,
  "110": 1.1,
  "125": 1.25,
  "150": 1.5,
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { refreshAppIframe } = useRunApp();
  const previewMode = useAtomValue(previewModeAtom);
  const { settings } = useSettings();

  useEffect(() => {
    const zoomLevel =
      settings?.workspaceZoomLevel ?? DEFAULT_WORKSPACE_ZOOM_LEVEL;
    const zoomFactor =
      WORKSPACE_ZOOM_FACTORS[zoomLevel] ??
      WORKSPACE_ZOOM_FACTORS[DEFAULT_WORKSPACE_ZOOM_LEVEL];

    const electronApi = (window as Window & {
      electron?: {
        webFrame?: {
          setZoomFactor: (factor: number) => void;
        };
      };
    }).electron;

    if (electronApi?.webFrame?.setZoomFactor) {
      electronApi.webFrame.setZoomFactor(zoomFactor);
      document.documentElement.style.setProperty("--workspace-font-scale", "1");

      return () => {
        electronApi.webFrame?.setZoomFactor(
          WORKSPACE_ZOOM_FACTORS[DEFAULT_WORKSPACE_ZOOM_LEVEL],
        );
      };
    }

    document.documentElement.style.setProperty(
      "--workspace-font-scale",
      zoomFactor.toString(),
    );

    return () => {
      document.documentElement.style.setProperty(
        "--workspace-font-scale",
        WORKSPACE_ZOOM_FACTORS[DEFAULT_WORKSPACE_ZOOM_LEVEL].toString(),
      );
    };
  }, [settings?.workspaceZoomLevel]);
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

  return (
    <>
      <ThemeProvider>
        <DeepLinkProvider>
          <SidebarProvider>
            <TitleBar />
            <AppSidebar />
            <div
              id="layout-main-content-container"
              className="flex h-screenish w-full overflow-x-hidden mt-12 mb-4 mr-4 border-t border-l border-border rounded-lg bg-background"
            >
              {children}
            </div>
            <Toaster richColors />
          </SidebarProvider>
        </DeepLinkProvider>
      </ThemeProvider>
    </>
  );
}
