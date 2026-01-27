import { createFileRoute } from "@tanstack/react-router";
import AutonomousAgentProductionDashboard from "@/components/AutonomousAgentProductionDashboard";

export const Route = createFileRoute("/autonomous-agent-production")({
  component: AutonomousAgentProductionDashboard,
});
