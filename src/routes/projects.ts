import { Route } from "@tanstack/react-router";
import ProjectsPage from "@/pages/projects";
import { rootRoute } from "./root";

export const projectsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectsPage,
});
