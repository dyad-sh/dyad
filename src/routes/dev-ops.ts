import { Route } from "@tanstack/react-router";

import DevOpsPage from "@/pages/dev-ops";
import { rootRoute } from "./root";

export const devOpsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/dev-ops",
  component: DevOpsPage,
});
