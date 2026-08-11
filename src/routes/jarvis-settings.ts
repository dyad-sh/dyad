import { Route } from "@tanstack/react-router";
import JarvisSettingsPage from "@/pages/jarvis-settings";
import { rootRoute } from "./root";

export const jarvisSettingsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/jarvis/settings",
  component: JarvisSettingsPage,
});
