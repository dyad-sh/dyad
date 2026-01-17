import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import ComputeNetworkPage from "../pages/compute-network";

export const computeNetworkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compute",
  component: ComputeNetworkPage,
});
