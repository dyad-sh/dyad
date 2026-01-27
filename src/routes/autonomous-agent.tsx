import { createFileRoute } from "@tanstack/react-router";
import AutonomousAgentPage from "@/pages/AutonomousAgentPage";

export const Route = createFileRoute("/autonomous-agent")({
  component: AutonomousAgentPage,
});
