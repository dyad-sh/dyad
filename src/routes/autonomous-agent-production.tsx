import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AutonomousAgentProductionDashboard from "@/components/AutonomousAgentProductionDashboard";

export const autonomousAgentProductionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/autonomous-agent-production",
  component: AutonomousAgentProductionDashboard,
});
