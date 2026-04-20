import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import NotificationCenterPage from "@/pages/NotificationCenterPage";

export const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: NotificationCenterPage,
});
