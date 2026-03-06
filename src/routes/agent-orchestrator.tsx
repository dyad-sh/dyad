import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AgentOrchestratorPage from "../pages/AgentOrchestratorPage";

export const agentOrchestratorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agent-orchestrator",
  component: AgentOrchestratorPage,
});
