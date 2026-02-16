// Route: /local-vault
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import LocalVaultPage from "../pages/local-vault/LocalVaultPage";

export const localVaultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local-vault",
  component: LocalVaultPage,
});
