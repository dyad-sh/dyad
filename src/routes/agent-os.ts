import { Route } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AgentOsPage from "@/pages/agent-os/AgentOsPage";

export const agentOsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/agent-os",
  component: AgentOsPage,
});
