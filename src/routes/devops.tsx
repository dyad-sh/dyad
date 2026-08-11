import { Route } from "@tanstack/react-router";
import DevOpsPage from "@/pages/dev-ops";
import GitHubManagerPage from "@/pages/github-manager";
import VercelManagerPage from "@/pages/vercel-manager";
import { rootRoute } from "./root";

/**
 * The Dev Ops hierarchy: overview, then a provider, then its projects.
 *
 * These render the pages that already existed. /dev-ops, /github and /vercel
 * stay registered too, so nothing that linked to them has moved.
 */

export const devOpsOverviewRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/devops",
  component: DevOpsPage,
});

export const devOpsGithubRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/devops/github",
  component: GitHubManagerPage,
});

export const devOpsVercelRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/devops/vercel",
  component: VercelManagerPage,
});
