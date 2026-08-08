import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import SettingsPage from "../pages/settings";

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
