import { createRoute, redirect } from "@tanstack/react-router";
import { rootRoute } from "./root";

/** Redirect /on-chain-marketplace → /nft-marketplace */
export const onChainMarketplaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/on-chain-marketplace",
  beforeLoad: () => {
    throw redirect({ to: "/nft-marketplace" });
  },
});
