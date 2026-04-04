import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import MarketplaceExplorerPage from "@/pages/marketplace-explorer";

export const marketplaceExplorerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketplace",
  component: MarketplaceExplorerPage,
});
