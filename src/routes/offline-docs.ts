import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const offlineDocsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/offline-docs",
  component: lazyRouteComponent(() => import("../pages/OfflineDocsPage")),
});
