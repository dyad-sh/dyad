import type { ComponentType } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Keeps My Apps and its normal-mode detail screen together in one desktop
 * window. App cards navigate through the shared router, so the window follows
 * that route instead of leaving the detail page hidden behind Desktop Mode.
 */
export function createDesktopAppsApp(
  AppsComponent: ComponentType,
  AppDetailsComponent: ComponentType,
): ComponentType {
  return function DesktopAppsApp() {
    const pathname = useRouterState({
      select: (state) => state.location.pathname,
    });

    return pathname.startsWith("/app-details") ? (
      <AppDetailsComponent />
    ) : (
      <AppsComponent />
    );
  };
}
