import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import DecentralizedChatPage from "../pages/decentralized-chat";

export const decentralizedChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decentralized-chat",
  component: DecentralizedChatPage,
});
