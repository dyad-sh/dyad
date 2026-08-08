import { Route } from "@tanstack/react-router";
import VercelManagerPage from "../pages/vercel-manager";
import { rootRoute } from "./root";

export const vercelManagerRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/vercel",
  component: VercelManagerPage,
});
