import { Route } from "@tanstack/react-router";
import PluginsPage from "../pages/plugins";
import { rootRoute } from "./root";

export const pluginsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/plugins",
  component: PluginsPage,
});
