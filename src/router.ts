import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/root";
import { homeRoute } from "./routes/home";
import { chatRoute } from "./routes/chat";
import { settingsRoute } from "./routes/settings";
import { providerSettingsRoute } from "./routes/settings/providers/$provider";
import { appDetailsRoute } from "./routes/app-details";
import { hubRoute } from "./routes/hub";
import { githubManagerRoute } from "./routes/github-manager";
import { vercelManagerRoute } from "./routes/vercel-manager";
import {
  chatAgentHomeRoute,
  chatAgentRoute,
  legacySocialMediaAgentRoute,
  plannerRoute,
} from "./routes/agents";
import {
  codingAgentsRoute,
  helixAgentRoute,
  openWorkerAgentRoute,
  buildForgeRoute,
  engineeringRoute,
} from "./routes/coding-agents";
import { libraryRoute } from "./routes/library";
import { appsRoute } from "./routes/apps";
import { themesRoute } from "./routes/themes";
import { promptsRoute } from "./routes/prompts";
import { mediaRoute } from "./routes/media";
import { agentOsRoute } from "./routes/agent-os";
import { agentsSectionRoute } from "./routes/agents-section";
import { buildCategoryRoutes, buildIndexRoute } from "./routes/build";
import { metaHdRoute } from "./routes/meta-hd";
import { vectorRoute } from "./routes/vector";
import { storageRoute } from "./routes/storage";
import { dataSourcesRoute } from "./routes/data-sources";
import { infrastructureRoute } from "./routes/infrastructure";
import { systemRoute } from "./routes/system";
import { devOpsRoute } from "./routes/dev-ops";
import { jarvisRoute } from "./routes/jarvis";
import { knowledgeBaseRoute } from "./routes/knowledge-base";
import { knowledgeCoreRoute } from "./routes/knowledge-core";

const routeTree = rootRoute.addChildren([
  jarvisRoute,
  knowledgeBaseRoute,
  knowledgeCoreRoute,
  chatAgentHomeRoute,
  chatAgentRoute,
  homeRoute,
  codingAgentsRoute,
  helixAgentRoute,
  openWorkerAgentRoute,
  engineeringRoute,
  buildForgeRoute,
  plannerRoute,
  legacySocialMediaAgentRoute,
  agentOsRoute,
  agentsSectionRoute,
  buildIndexRoute,
  ...buildCategoryRoutes,
  storageRoute,
  dataSourcesRoute,
  infrastructureRoute,
  systemRoute,
  metaHdRoute,
  vectorRoute,
  devOpsRoute,
  hubRoute,
  githubManagerRoute,
  vercelManagerRoute,
  libraryRoute,
  appsRoute,
  themesRoute,
  promptsRoute,
  mediaRoute,
  chatRoute,
  appDetailsRoute,
  settingsRoute.addChildren([providerSettingsRoute]),
]);

// src/components/NotFoundRedirect.tsx
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { ErrorBoundary } from "./components/ErrorBoundary";

export function NotFoundRedirect() {
  const navigate = useNavigate();

  React.useEffect(() => {
    // Navigate to the main route ('/') immediately on mount
    // 'replace: true' prevents the invalid URL from being added to browser history
    navigate({ to: "/", replace: true });
  }, [navigate]); // Dependency array ensures this runs only once

  // Optionally render null or a loading indicator while redirecting
  // The redirect is usually very fast, so null is often fine.
  return null;
  // Or: return <div>Redirecting...</div>;
}

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFoundRedirect,
  defaultErrorComponent: ErrorBoundary,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
