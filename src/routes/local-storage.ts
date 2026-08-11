import { Route } from "@tanstack/react-router";
import LocalStoragePage from "@/pages/local-storage";
import { rootRoute } from "./root";

export const localStorageRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/local-storage",
  component: LocalStoragePage,
});
