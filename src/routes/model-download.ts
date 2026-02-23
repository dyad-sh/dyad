import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const modelDownloadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/model-download",
  component: lazyRouteComponent(() => import("@/pages/ModelDownloadPage")),
});
