import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import FederationPage from "@/pages/federation";

export const federationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/federation",
  component: FederationPage,
});
