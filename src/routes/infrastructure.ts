import { Route } from "@tanstack/react-router";
import InfrastructurePage from "../pages/infrastructure";
import { rootRoute } from "./root";

/** Live inventory of whatever is actually running on this machine. */
export const infrastructureRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/infrastructure",
  component: InfrastructurePage,
});
