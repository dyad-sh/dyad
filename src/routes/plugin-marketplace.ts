import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const pluginMarketplaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plugin-marketplace",
  component: lazyRouteComponent(() => import("../pages/PluginMarketplacePage")),
});
