import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import ChatPage from "../pages/chat";
import { z } from "zod";

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
  validateSearch: z.object({
    id: z.number().optional(),
    appId: z.number().optional(),
  }),
});
