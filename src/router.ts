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
import { documentsRoute, documentEditorRoute } from "./routes/documents";
import { deployRoute } from "./routes/deploy";
import { datasetsRoute } from "./routes/datasets";
import { assetStudioRoute } from "./routes/asset-studio";
import { nftMarketplaceRoute } from "./routes/nft-marketplace";
import { creatorNetworkRoute } from "./routes/creator-network";
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

import { modelDownloadRoute } from "./routes/model-download";

import { offlineDocsRoute } from "./routes/offline-docs";
import { aiLearningRoute } from "./routes/ai-learning";
import { benchmarkRoute } from "./routes/benchmark";
import { codingAgentRoute } from "./routes/coding-agent";
import { designSystemRoute } from "./routes/design-system";
import { pluginMarketplaceRoute } from "./routes/plugin-marketplace";
import { secretsVaultRoute } from "./routes/secrets-vault";

import { memoryRoute } from "./routes/memory";
import { openclawKanbanRoute } from "./routes/openclaw-kanban";
import { openclawControlRoute } from "./routes/openclaw-control";
import { systemServicesRoute } from "./routes/system-services";
import { modelRegistryRoute } from "./routes/model-registry";
import { emailHubRoute } from "./routes/email-hub";

import { integrationsRoute } from "./routes/integrations";
import { myMarketplaceAssetsRoute } from "./routes/my-marketplace-assets";
import { creatorDashboardRoute } from "./routes/creator-dashboard";
import { neuralBuilderRoute } from "./routes/neural-builder";
import { cicdBuilderRoute } from "./routes/cicd-builder";
import { calendarRoute } from "./routes/calendar";
import { skillsRoute } from "./routes/skills";
import { trainingCenterRoute } from "./routes/training-center";
import { createAssetRoute } from "./routes/create-asset";
import { onChainMarketplaceRoute } from "./routes/on-chain-marketplace";
import { tokenomicsRoute } from "./routes/tokenomics";
import { a2aNetworkRoute } from "./routes/a2a-network";
import { governanceRoute } from "./routes/governance";
import { nlpStudioRoute } from "./routes/nlp-studio";
import { appPublishingRoute } from "./routes/app-publishing";
import { unifiedIdentityRoute } from "./routes/unified-identity";
import { appBuilderRoute } from "./routes/app-builder";
import { marketplaceExplorerRoute } from "./routes/marketplace-explorer";
import { scrapingRoute } from "./routes/scraping";
import { notificationsRoute } from "./routes/notifications";
import { profileRoute } from "./routes/profile";
import { adminRoute } from "./routes/admin";
import { auditLogRoute } from "./routes/audit-log";
import { backupRoute } from "./routes/backup";
import { federationRoute } from "./routes/federation";
import { analyticsRoute } from "./routes/analytics";
import { teamRoute } from "./routes/team";
import { imageStudioRoute } from "./routes/image-studio";
import { videoStudioRoute } from "./routes/video-studio";
import { ssiCredentialsRoute } from "./routes/ssi-credentials";
import { creatorProfileRoute } from "./routes/creator-profile";

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
  documentEditorRoute,
  deployRoute,
  datasetsRoute,
  assetStudioRoute,
  nftMarketplaceRoute,
  creatorNetworkRoute,
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


  modelDownloadRoute,

  offlineDocsRoute,
  aiLearningRoute,
  benchmarkRoute,
  codingAgentRoute,
  designSystemRoute,
  pluginMarketplaceRoute,
  secretsVaultRoute,

  memoryRoute,
  openclawKanbanRoute,
  openclawControlRoute,
  systemServicesRoute,
  modelRegistryRoute,
  emailHubRoute,

  integrationsRoute,
  myMarketplaceAssetsRoute,
  creatorDashboardRoute,
  neuralBuilderRoute,
  cicdBuilderRoute,
  calendarRoute,
  skillsRoute,
  trainingCenterRoute,
  createAssetRoute,
  onChainMarketplaceRoute,
  tokenomicsRoute,
  a2aNetworkRoute,
  governanceRoute,
  nlpStudioRoute,
  appPublishingRoute,
  unifiedIdentityRoute,
  appBuilderRoute,
  marketplaceExplorerRoute,
  scrapingRoute,
  notificationsRoute,
  profileRoute,
  adminRoute,
  auditLogRoute,
  backupRoute,
  federationRoute,
  analyticsRoute,
  teamRoute,
  imageStudioRoute,
  videoStudioRoute,
  ssiCredentialsRoute,
  creatorProfileRoute,
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
