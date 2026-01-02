import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import NFTMarketplacePage from "@/pages/nft-marketplace";

export const nftMarketplaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/nft-marketplace",
  component: NFTMarketplacePage,
});
