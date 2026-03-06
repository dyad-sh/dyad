import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const secretsVaultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/secrets-vault",
  component: lazyRouteComponent(() => import("../pages/SecretsVaultPage")),
});
