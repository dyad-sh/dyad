import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AppDetailsPage from "../pages/app-details";
import { z } from "zod";

export const appDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app-details",
  component: AppDetailsPage,
  validateSearch: z.object({
    appId: z.number().optional(),
    provider: z.enum(["neon", "supabase"]).optional(),
  }),
});
