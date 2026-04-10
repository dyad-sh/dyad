import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import MyMarketplaceAssetsPage from "@/pages/my-marketplace-assets";

export const myMarketplaceAssetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/my-marketplace-assets",
  component: MyMarketplaceAssetsPage,
});
