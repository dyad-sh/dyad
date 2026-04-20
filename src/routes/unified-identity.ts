import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const unifiedIdentityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/identity",
  component: lazyRouteComponent(() => import("@/pages/UnifiedIdentityPage")),
});
