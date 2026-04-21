import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import SSICredentialsPage from "@/pages/SSICredentialsPage";

export const ssiCredentialsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ssi-credentials",
  component: SSICredentialsPage,
});
