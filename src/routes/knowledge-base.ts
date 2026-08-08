import { Route } from "@tanstack/react-router";
import KnowledgeBasePage from "../pages/knowledge-base/KnowledgeBasePage";
import { rootRoute } from "./root";

export const knowledgeBaseRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/knowledge-base",
  component: KnowledgeBasePage,
});
