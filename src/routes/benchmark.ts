import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const benchmarkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/benchmark",
  component: lazyRouteComponent(() => import("../pages/BenchmarkPage")),
});
