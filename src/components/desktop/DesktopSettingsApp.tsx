import type { ComponentType } from "react";
import { useRouterState } from "@tanstack/react-router";

import { ProviderSettingsPage } from "@/components/settings/ProviderSettingsPage";

/**
 * Settings inside a desktop window.
 *
 * The provider configuration screen is a child *route* (`/settings/providers/…`)
 * rendered through the router's outlet — which a desktop window does not have.
 * Clicking a provider navigates the (hidden) router and, without this wrapper,
 * the window keeps showing the top-level settings and nothing appears to
 * happen. Following the live location keeps the window in step with every
 * navigation the settings page performs.
 */
export function createDesktopSettingsApp(
  SettingsComponent: ComponentType,
): ComponentType {
  return function DesktopSettingsApp() {
    const pathname = useRouterState({
      select: (state) => state.location.pathname,
    });

    const providerMatch = /^\/settings\/providers\/([^/]+)/.exec(pathname);
    if (providerMatch) {
      return (
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
          <ProviderSettingsPage
            provider={decodeURIComponent(providerMatch[1])}
          />
        </div>
      );
    }

    return <SettingsComponent />;
  };
}
