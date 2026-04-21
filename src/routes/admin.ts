import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AdminDashboardPage from "@/pages/AdminDashboardPage";

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminDashboardPage,
});
