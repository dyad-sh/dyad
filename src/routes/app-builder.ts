import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const appBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app-builder",
  component: lazyRouteComponent(() => import("@/pages/AppBuilderStudioPage")),
});
