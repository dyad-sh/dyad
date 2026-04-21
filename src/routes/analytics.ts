import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AnalyticsDashboardPage from "@/pages/AnalyticsDashboardPage";

export const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  component: AnalyticsDashboardPage,
});
