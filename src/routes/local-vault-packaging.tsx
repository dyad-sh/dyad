// Route: /local-vault/packaging
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import PackagingPage from "../pages/local-vault/PackagingPage";

export const packagingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local-vault/packaging",
  component: PackagingPage,
});
