import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memory",
  component: lazyRouteComponent(() => import("../pages/MemoryPage")),
});
