import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import SystemPage from "../pages/system";

/**
 * /settings renders System.
 *
 * There was one set of settings behind two screens, each with its own rail and
 * its own header. The route stays so every existing link keeps working; what it
 * renders is the canonical screen.
 */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: function SettingsRouteComponent() {
    return <SystemPage followActiveSettingsTab />;
  },
});
