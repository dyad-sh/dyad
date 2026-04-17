import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const trainingCenterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/training",
  component: lazyRouteComponent(() => import("../pages/training-center")),
});
