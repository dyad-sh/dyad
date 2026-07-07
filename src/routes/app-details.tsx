import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AppDetailsPage from "../pages/app-details";
import { appDetailsSearchSchema } from "./appDetailsSearchSchema";

export const appDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app-details",
  component: AppDetailsPage,
  validateSearch: appDetailsSearchSchema,
});
