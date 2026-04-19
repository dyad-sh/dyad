import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const a2aNetworkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/a2a-network",
  component: lazyRouteComponent(() => import("../pages/A2ANetworkPage")),
});
