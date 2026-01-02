import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const localModelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local-models",
  component: lazyRouteComponent(() => import("@/pages/local-models")),
});
