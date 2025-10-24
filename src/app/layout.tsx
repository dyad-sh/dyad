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
import type { WorkspaceTextSize } from "@/lib/schemas";

const DEFAULT_WORKSPACE_TEXT_SIZE: WorkspaceTextSize = "medium";
const WORKSPACE_TEXT_SCALE: Record<WorkspaceTextSize, number> = {
  small: 0.9,
  medium: 1,
  large: 1.1,
  extraLarge: 1.25,
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
    const textSize =
      settings?.workspaceTextSize ?? DEFAULT_WORKSPACE_TEXT_SIZE;
    const scale =
      WORKSPACE_TEXT_SCALE[textSize] ??
      WORKSPACE_TEXT_SCALE[DEFAULT_WORKSPACE_TEXT_SIZE];

    document.documentElement.style.setProperty(
      "--workspace-font-scale",
      scale.toString(),
    );

    return () => {
      document.documentElement.style.setProperty(
        "--workspace-font-scale",
        WORKSPACE_TEXT_SCALE[DEFAULT_WORKSPACE_TEXT_SIZE].toString(),
      );
    };
  }, [settings?.workspaceTextSize]);
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
