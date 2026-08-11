import { Route } from "@tanstack/react-router";
import AgentsPage from "@/pages/agents";
import { rootRoute } from "./root";

/**
 * The Agents index. /agent-os and the coding routes are untouched and still
 * registered; this only adds a categorised way in.
 */
export const agentsSectionRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: AgentsPage,
});
