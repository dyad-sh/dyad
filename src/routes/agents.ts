import { Route } from "@tanstack/react-router";
import ChatAgentPage from "../pages/chat-agent";
import SocialMediaAgentPage from "../pages/social-media/SocialMediaAgentPage";
import { rootRoute } from "./root";

export const chatAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat-agent",
  component: ChatAgentPage,
});

export const plannerRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/planner",
  component: SocialMediaAgentPage,
});

export const legacySocialMediaAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/social-media-agent",
  component: SocialMediaAgentPage,
});
