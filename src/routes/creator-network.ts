import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import CreatorNetworkPage from "@/pages/creator-network/CreatorNetworkPage";

export const creatorNetworkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/creator-network",
  component: CreatorNetworkPage,
});
