import { Route } from "@tanstack/react-router";
import SystemPage from "../pages/system";
import { rootRoute } from "./root";

/** Everything technical, behind one entry rather than eleven. */
export const systemRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/system",
  component: SystemPage,
});
