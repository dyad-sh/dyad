import { Route } from "@tanstack/react-router";
import GitHubManagerPage from "../pages/github-manager";
import { rootRoute } from "./root";

export const githubManagerRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/github",
  component: GitHubManagerPage,
});
