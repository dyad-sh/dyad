import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../root";
import JoyMyStoresPage from "@/pages/joy/MyStoresPage";

export const joyMyStoresRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/joy/my-stores",
  component: JoyMyStoresPage,
});
