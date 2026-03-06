import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const designSystemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/design-system",
  component: lazyRouteComponent(() => import("../pages/DesignSystemPage")),
});
