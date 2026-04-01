import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { lazyRouteComponent } from "@tanstack/react-router";

export const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/integrations",
  component: lazyRouteComponent(() => import("../pages/integrations")),
});
