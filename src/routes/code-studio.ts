import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const codeStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/code-studio",
  component: lazyRouteComponent(() => import("../pages/CodeStudioPage")),
});
