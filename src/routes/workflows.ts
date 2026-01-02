import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { WorkflowsPage } from "@/pages/workflows";

export const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows",
  component: WorkflowsPage,
});
