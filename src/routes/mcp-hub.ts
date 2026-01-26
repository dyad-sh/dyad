import { Route } from "@tanstack/react-router";
import McpHubPage from "../pages/mcp-hub";
import { rootRoute } from "./root";

export const mcpHubRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/mcp-hub",
  component: McpHubPage,
});
