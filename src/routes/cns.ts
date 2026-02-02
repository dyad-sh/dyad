import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const cnsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cns",
}).lazy(() => import("../pages/cns").then((d) => ({ component: d.default })));
