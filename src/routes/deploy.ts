import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import DeployPage from "@/pages/deploy";

export const deployRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/deploy",
  component: DeployPage,
});
