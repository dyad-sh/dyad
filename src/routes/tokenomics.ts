import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const tokenomicsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tokenomics",
  component: lazyRouteComponent(() => import("../pages/TokenomicsPage")),
});
