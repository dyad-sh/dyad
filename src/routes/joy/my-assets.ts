import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../root";
import JoyMyAssetsPage from "@/pages/joy/MyAssetsPage";

export const joyMyAssetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/joy/my-assets",
  component: JoyMyAssetsPage,
});
