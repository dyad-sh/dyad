import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import TeamManagementPage from "@/pages/TeamManagementPage";

export const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team",
  component: TeamManagementPage,
});
