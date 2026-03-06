import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const codingAgentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coding-agent",
  component: lazyRouteComponent(() => import("../pages/CodingAgentPage")),
});
