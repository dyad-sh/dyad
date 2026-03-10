import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { OpenClawKanbanPage } from "@/pages/OpenClawKanbanPage";

export const openclawKanbanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/openclaw-kanban",
  component: OpenClawKanbanPage,
});
