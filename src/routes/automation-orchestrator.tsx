import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AutomationOrchestrator from "../pages/AutomationOrchestrator";

export const automationOrchestratorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/automation-orchestrator",
  component: AutomationOrchestrator,
});
