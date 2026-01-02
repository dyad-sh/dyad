/**
 * Agent Builder Routes
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

// Agent list route
export const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: lazyRouteComponent(() => import("../pages/agents")),
});

// Agent editor route
export const agentEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents/$agentId",
  component: lazyRouteComponent(() => import("../pages/agent-editor")),
});

// Agent test route
export const agentTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents/$agentId/test",
  component: lazyRouteComponent(() => import("../pages/agent-test")),
});
