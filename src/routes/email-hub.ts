import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { EmailHubPage } from "@/pages/EmailHubPage";

export const emailHubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/email-hub",
  component: EmailHubPage,
});
