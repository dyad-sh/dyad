import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const datasetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/datasets",
  component: lazyRouteComponent(() => import("../pages/dataset-studio/DatasetStudioPage")),
});
