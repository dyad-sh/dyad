import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { CollaborationHubPage } from "@/pages/CollaborationHubPage";
import { CollaborationActivityPage } from "@/pages/CollaborationActivityPage";

export const collaborationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collaboration",
  component: CollaborationHubPage,
});

export const collaborationActivityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collaboration/activity",
  component: CollaborationActivityPage,
});
