import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const nlpStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/nlp-studio",
  component: lazyRouteComponent(() => import("../pages/NlpStudioPage")),
});
