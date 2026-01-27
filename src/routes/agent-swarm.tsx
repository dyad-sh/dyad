import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AgentSwarmPage from "../pages/AgentSwarmPage";

export const agentSwarmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agent-swarm",
  component: AgentSwarmPage,
});
