/**
 * Skills Route
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills",
  component: lazyRouteComponent(() => import("../pages/skills")),
});
