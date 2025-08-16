import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { MultiAgentView } from "../components/MultiAgentView";

export const multiAgentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/multi-agent",
  component: MultiAgentView,
});
