import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/root";
import { homeRoute } from "./routes/home";
import { chatRoute } from "./routes/chat";
import { settingsRoute } from "./routes/settings";
import { providerSettingsRoute } from "./routes/settings/providers/$provider";
import { appDetailsRoute } from "./routes/app-details";
import { hubRoute } from "./routes/hub";
import { mcpHubRoute } from "./routes/mcp-hub";
import { libraryRoute } from "./routes/library";
import { agentsRoute, agentEditorRoute, agentTestRoute, agentPreviewRoute } from "./routes/agents";
import { workflowsRoute } from "./routes/workflows";
import { localModelsRoute } from "./routes/local-models";
import { documentsRoute } from "./routes/documents";
import { deployRoute } from "./routes/deploy";
import { datasetsRoute } from "./routes/datasets";
import { assetStudioRoute } from "./routes/asset-studio";
import { nftMarketplaceRoute } from "./routes/nft-marketplace";
import { federationRoute } from "./routes/federation";
import { dataSovereigntyRoute } from "./routes/data-sovereignty";
import { decentralizedDeployRoute } from "./routes/decentralized-deploy";
import { decentralizedChatRoute } from "./routes/decentralized-chat";
import { computeNetworkRoute } from "./routes/compute-network";
import { agentSwarmRoute } from "./routes/agent-swarm";
import { autonomousAgentRoute } from "./routes/autonomous-agent";
import { agentOrchestratorRoute } from "./routes/agent-orchestrator";
import { autonomousAgentProductionRoute } from "./routes/autonomous-agent-production";
import { cnsRoute } from "./routes/cns";
import { localVaultRoute } from "./routes/local-vault";
import { connectorsRoute } from "./routes/local-vault-connectors";
import { dataStudioLocalRoute } from "./routes/local-vault-data-studio";
import { packagingRoute } from "./routes/local-vault-packaging";
import { webScraperRoute } from "./routes/local-vault-web-scraper";
import { scrapeWizardRoute } from "./routes/local-vault-scrape-wizard";
import { knowledgeBaseRoute } from "./routes/knowledge-base";
import { modelDownloadRoute } from "./routes/model-download";
import { memoryLearningRoute } from "./routes/local-vault-memory";
import { offlineDocsRoute } from "./routes/offline-docs";
import { aiLearningRoute } from "./routes/ai-learning";
import { benchmarkRoute } from "./routes/benchmark";
import { codingAgentRoute } from "./routes/coding-agent";
import { designSystemRoute } from "./routes/design-system";
import { pluginMarketplaceRoute } from "./routes/plugin-marketplace";
import { secretsVaultRoute } from "./routes/secrets-vault";
import { dataStudioRoute } from "./routes/data-studio";
import { memoryRoute } from "./routes/memory";
import { openclawKanbanRoute } from "./routes/openclaw-kanban";
import { openclawControlRoute } from "./routes/openclaw-control";
import { systemServicesRoute } from "./routes/system-services";
import { modelRegistryRoute } from "./routes/model-registry";
import { emailHubRoute } from "./routes/email-hub";
import { scrapingRoute } from "./routes/scraping";

const routeTree = rootRoute.addChildren([
  homeRoute,
  hubRoute,
  mcpHubRoute,
  libraryRoute,
  chatRoute,
  appDetailsRoute,
  settingsRoute,
  providerSettingsRoute,
  agentsRoute,
  agentEditorRoute,
  agentTestRoute,
  agentPreviewRoute,
  workflowsRoute,
  localModelsRoute,
  documentsRoute,
  deployRoute,
  datasetsRoute,
  assetStudioRoute,
  nftMarketplaceRoute,
  federationRoute,
  dataSovereigntyRoute,
  decentralizedDeployRoute,
  decentralizedChatRoute,
  computeNetworkRoute,
  agentSwarmRoute,
  autonomousAgentRoute,
  agentOrchestratorRoute,
  autonomousAgentProductionRoute,
  cnsRoute,
  localVaultRoute,
  connectorsRoute,
  dataStudioLocalRoute,
  packagingRoute,
  webScraperRoute,
  scrapeWizardRoute,
  knowledgeBaseRoute,
  modelDownloadRoute,
  memoryLearningRoute,
  offlineDocsRoute,
  aiLearningRoute,
  benchmarkRoute,
  codingAgentRoute,
  designSystemRoute,
  pluginMarketplaceRoute,
  secretsVaultRoute,
  dataStudioRoute,
  memoryRoute,
  openclawKanbanRoute,
  openclawControlRoute,
  systemServicesRoute,
  modelRegistryRoute,
  emailHubRoute,
  scrapingRoute,
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
