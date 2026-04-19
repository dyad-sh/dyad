import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const governanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/governance",
  component: lazyRouteComponent(() => import("../pages/GovernancePage")),
});
