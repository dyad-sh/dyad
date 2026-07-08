import { Route } from "@tanstack/react-router";
import TemplatesPage from "../pages/templates";
import { rootRoute } from "./root";

export const templatesRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/templates",
  component: TemplatesPage,
});
