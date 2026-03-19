import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const modelRegistryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/model-registry",
  component: lazyRouteComponent(() => import("@/pages/model-registry")),
});
