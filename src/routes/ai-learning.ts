import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const aiLearningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai-learning",
  component: lazyRouteComponent(() => import("../pages/AILearningPage")),
});
