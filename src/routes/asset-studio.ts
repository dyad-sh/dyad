import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AssetStudioPage from "../pages/asset-studio";

export const assetStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/asset-studio",
  component: AssetStudioPage,
});
