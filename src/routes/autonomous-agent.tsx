import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AutonomousAgentPage from "@/pages/AutonomousAgentPage";

export const autonomousAgentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/autonomous-agent",
  component: AutonomousAgentPage,
});
