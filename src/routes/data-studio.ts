import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const dataStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/data-studio",
  component: lazyRouteComponent(() => import("../pages/data-studio")),
});
