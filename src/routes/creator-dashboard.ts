import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import CreatorDashboardPage from "@/pages/creator-dashboard";

export const creatorDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/creator",
  component: CreatorDashboardPage,
});
