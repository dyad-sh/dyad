import { Route } from "@tanstack/react-router";
import KnowledgeCorePage from "../pages/knowledge-core";
import { rootRoute } from "./root";

export const knowledgeCoreRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/knowledge-core",
  component: KnowledgeCorePage,
});
