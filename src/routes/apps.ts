import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AppsPage from "../pages/apps";

export const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: AppsPage,
});
