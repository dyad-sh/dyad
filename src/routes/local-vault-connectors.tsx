// Route: /local-vault/connectors
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import ConnectorsPage from "../pages/local-vault/ConnectorsPage";

export const connectorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local-vault/connectors",
  component: ConnectorsPage,
});
