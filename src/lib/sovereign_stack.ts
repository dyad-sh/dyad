/**
 * Sovereign Stack - Complete Self-Hosted Development Platform
 * 
 * This module exports all services that make JoyCreate a fully self-sufficient
 * platform for creating agents, apps, datasets, workflows, and dApps without
 * relying on third-party services.
 * 
 * Services included:
 * 
 * 1. Local Model Manager - Download and run LLMs locally (Ollama, llama.cpp)
 * 2. Vector Store Service - Local embeddings and RAG without cloud services
 * 3. Visual App Builder - Drag-drop UI builder with multi-framework export
 * 4. Smart Contract Studio - Create, deploy, and manage smart contracts
 * 5. Local CI/CD Pipeline - Build, test, and deploy without GitHub Actions
 * 6. Crypto Payment Gateway - Accept payments without Stripe/PayPal
 * 7. Collaborative Workspace - Real-time collaboration via CRDT
 * 8. Local Fine-tuning - LoRA/QLoRA training on local hardware
 * 9. Media Generation - Image, audio, and video generation locally
 * 10. Self-hosted Analytics - Privacy-preserving analytics
 */

// =============================================================================
// SERVICE EXPORTS
// =============================================================================

// Local AI & Models
export { localModelManager, LocalModelManager } from "./local_model_manager";
export { vectorStoreService, VectorStoreService } from "./vector_store_service";
export { localFineTuning, LocalFineTuning } from "./local_fine_tuning";

// App Development
export { visualAppBuilder, VisualAppBuilder } from "./visual_app_builder";
export { localCICDPipeline, LocalCICDPipeline } from "./local_cicd_pipeline";

// Blockchain & Payments
export { smartContractStudio, SmartContractStudio } from "./smart_contract_studio";
export { cryptoPaymentGateway, CryptoPaymentGateway } from "./crypto_payment_gateway";

// Collaboration & Media
export { collaborativeWorkspace, CollaborativeWorkspace } from "./collaborative_workspace";
export { mediaGeneration, MediaGeneration } from "./media_generation";

// Analytics
export { selfHostedAnalytics, SelfHostedAnalytics } from "./self_hosted_analytics";

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type {
  // Model types
  ModelId,
  LocalModel,
  ModelDownloadProgress,
  InferenceOptions,
  InferenceResult,
  
  // Vector store types
  CollectionId,
  VectorCollection,
  Document,
  SearchResult,
  RAGOptions,
  RAGResult,
  
  // App builder types
  ProjectId,
  ComponentId,
  AppProject,
  AppComponent,
  ComponentProperty,
  ExportOptions,
  ExportResult,
  
  // Smart contract types
  ContractId,
  SmartContract,
  ContractTemplate,
  DeploymentResult,
  ContractInteraction,
  
  // CI/CD types
  PipelineId,
  Pipeline,
  PipelineStep,
  PipelineRun,
  BuildArtifact,
  
  // Payment types
  PaymentId,
  Payment,
  PaymentConfig,
  Subscription,
  PaymentWebhook,
  PaymentAnalytics,
  
  // Collaboration types
  WorkspaceId,
  Workspace,
  CollaborativeDocument,
  DocumentOperation,
  CRDTState,
  Collaborator,
  PresenceInfo,
  Comment,
  SyncStatus,
  
  // Fine-tuning types
  FineTuneJobId,
  FineTuneJob,
  TrainingDataset,
  TrainingConfig,
  TrainingProgress,
  ModelAdapter,
  EvaluationResult,
  
  // Media types
  MediaGenerationId,
  ImageGenerationJob,
  AudioGenerationJob,
  VideoGenerationJob,
  GeneratedMedia,
  MediaModel,
  
  // Analytics types
  AnalyticsEvent,
  AnalyticsMetric,
  Dashboard,
  DashboardWidget,
  TimeRange,
  AggregatedData,
  UserBehavior,
  PerformanceMetric,
} from "@/types/sovereign_stack_types";

// =============================================================================
// INITIALIZATION HELPER
// =============================================================================

/**
 * Initialize all Sovereign Stack services
 * Call this once during app startup
 */
export async function initializeSovereignStack(): Promise<void> {
  const { localModelManager } = await import("./local_model_manager");
  const { vectorStoreService } = await import("./vector_store_service");
  const { visualAppBuilder } = await import("./visual_app_builder");
  const { smartContractStudio } = await import("./smart_contract_studio");
  const { localCICDPipeline } = await import("./local_cicd_pipeline");
  const { cryptoPaymentGateway } = await import("./crypto_payment_gateway");
  const { collaborativeWorkspace } = await import("./collaborative_workspace");
  const { localFineTuning } = await import("./local_fine_tuning");
  const { mediaGeneration } = await import("./media_generation");
  const { selfHostedAnalytics } = await import("./self_hosted_analytics");
  
  await Promise.all([
    localModelManager.initialize(),
    vectorStoreService.initialize(),
    visualAppBuilder.initialize(),
    smartContractStudio.initialize(),
    localCICDPipeline.initialize(),
    cryptoPaymentGateway.initialize(),
    collaborativeWorkspace.initialize(),
    localFineTuning.initialize(),
    mediaGeneration.initialize(),
    selfHostedAnalytics.initialize(),
  ]);
}

/**
 * Shutdown all Sovereign Stack services gracefully
 * Call this during app shutdown
 */
export async function shutdownSovereignStack(): Promise<void> {
  const { localModelManager } = await import("./local_model_manager");
  const { vectorStoreService } = await import("./vector_store_service");
  const { visualAppBuilder } = await import("./visual_app_builder");
  const { smartContractStudio } = await import("./smart_contract_studio");
  const { localCICDPipeline } = await import("./local_cicd_pipeline");
  const { cryptoPaymentGateway } = await import("./crypto_payment_gateway");
  const { collaborativeWorkspace } = await import("./collaborative_workspace");
  const { localFineTuning } = await import("./local_fine_tuning");
  const { mediaGeneration } = await import("./media_generation");
  const { selfHostedAnalytics } = await import("./self_hosted_analytics");
  
  await Promise.all([
    localModelManager.shutdown(),
    vectorStoreService.shutdown(),
    visualAppBuilder.shutdown(),
    smartContractStudio.shutdown(),
    localCICDPipeline.shutdown(),
    cryptoPaymentGateway.shutdown(),
    collaborativeWorkspace.shutdown(),
    localFineTuning.shutdown(),
    mediaGeneration.shutdown(),
    selfHostedAnalytics.shutdown(),
  ]);
}

// =============================================================================
// SERVICE REGISTRY
// =============================================================================

/**
 * Registry of all Sovereign Stack services for introspection
 */
export const SovereignStackServices = {
  localAI: {
    modelManager: "localModelManager",
    vectorStore: "vectorStoreService",
    fineTuning: "localFineTuning",
  },
  appDevelopment: {
    appBuilder: "visualAppBuilder",
    cicd: "localCICDPipeline",
  },
  blockchain: {
    contracts: "smartContractStudio",
    payments: "cryptoPaymentGateway",
  },
  collaboration: {
    workspace: "collaborativeWorkspace",
    media: "mediaGeneration",
  },
  observability: {
    analytics: "selfHostedAnalytics",
  },
} as const;

/**
 * Feature capabilities provided by the Sovereign Stack
 */
export const SovereignStackCapabilities = {
  // AI Capabilities
  localLLM: true,
  localEmbeddings: true,
  localRAG: true,
  localFineTuning: true,
  localImageGeneration: true,
  localAudioGeneration: true,
  localVideoGeneration: true,
  localSpeechToText: true,
  localTextToSpeech: true,
  
  // Development Capabilities
  visualUIBuilder: true,
  multiFrameworkExport: true,
  localCICD: true,
  automaticTesting: true,
  containerSupport: true,
  
  // Blockchain Capabilities
  smartContractCreation: true,
  multiChainDeployment: true,
  cryptoPayments: true,
  nftMinting: true,
  daoGovernance: true,
  
  // Collaboration Capabilities
  realTimeEditing: true,
  crdtSync: true,
  offlineFirst: true,
  p2pCollaboration: true,
  
  // Analytics Capabilities
  privacyPreserving: true,
  localDataStorage: true,
  customDashboards: true,
  exportCapability: true,
  
  // Overall
  noCloudDependency: true,
  selfHosted: true,
  dataOwnership: true,
} as const;
