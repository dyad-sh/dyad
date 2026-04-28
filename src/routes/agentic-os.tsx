import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { AgenticOSDashboard } from "@/pages/AgenticOSDashboard";

export const agenticOSRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agentic-os",
  component: AgenticOSDashboard,
});