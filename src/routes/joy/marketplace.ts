import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../root";
import JoyMarketplacePage from "@/pages/joy/MarketplacePage";

export const joyMarketplaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/joy/marketplace",
  component: JoyMarketplacePage,
});
