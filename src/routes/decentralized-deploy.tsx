import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import DecentralizedDeployPage from "../pages/decentralized-deploy";

export const decentralizedDeployRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decentralized-deploy",
  component: DecentralizedDeployPage,
});
