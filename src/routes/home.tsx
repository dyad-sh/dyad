import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import HomePage from "../pages/home";
import { z } from "zod";
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coder/studio",
  component: HomePage,
  validateSearch: z.object({
    appId: z.number().optional(),
  }),
});
