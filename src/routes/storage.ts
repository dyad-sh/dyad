import { Route } from "@tanstack/react-router";

import StoragePage from "@/pages/storage/StoragePage";
import { rootRoute } from "./root";

export const storageRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/storage",
  component: StoragePage,
});
