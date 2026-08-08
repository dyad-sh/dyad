import { Route } from "@tanstack/react-router";

import VectorWorkspacePage from "@/pages/vector/VectorWorkspacePage";
import { rootRoute } from "./root";

export const vectorRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/vector",
  component: VectorWorkspacePage,
});
