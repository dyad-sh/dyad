import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const appPublishingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app-publishing",
  component: lazyRouteComponent(() => import("../pages/AppPublishingStudio")),
});
