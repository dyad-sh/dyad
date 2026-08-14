import { Route } from "@tanstack/react-router";
import { rootRoute } from "./root";
import DashboardPage from "@/pages/dashboard";

/**
 * The dashboard owns "/", so it is what the app opens on, and also answers at
 * "/dashboard" so it can be linked to by name. The chat agent keeps
 * "/chat-agent", which is where the sidebar has always sent it.
 */
export const dashboardIndexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

export const dashboardRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: DashboardPage,
});
