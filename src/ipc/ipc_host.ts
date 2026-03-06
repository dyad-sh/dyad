import { registerAppHandlers } from "./handlers/app_handlers";
import { registerChatHandlers } from "./handlers/chat_handlers";
import { registerChatStreamHandlers } from "./handlers/chat_stream_handlers";
import { registerSettingsHandlers } from "./handlers/settings_handlers";
import { registerShellHandlers } from "./handlers/shell_handler";
import { registerDependencyHandlers } from "./handlers/dependency_handlers";
import { registerGithubHandlers } from "./handlers/github_handlers";
import { registerVercelHandlers } from "./handlers/vercel_handlers";
import { registerNodeHandlers } from "./handlers/node_handlers";
import { registerProposalHandlers } from "./handlers/proposal_handlers";
import { registerDebugHandlers } from "./handlers/debug_handlers";
import { registerSupabaseHandlers } from "./handlers/supabase_handlers";
import { registerNeonHandlers } from "./handlers/neon_handlers";
import { registerLocalModelHandlers } from "./handlers/local_model_handlers";
import { registerTokenCountHandlers } from "./handlers/token_count_handlers";
import { registerWindowHandlers } from "./handlers/window_handlers";
import { registerUploadHandlers } from "./handlers/upload_handlers";
import { registerVersionHandlers } from "./handlers/version_handlers";
import { registerLanguageModelHandlers } from "./handlers/language_model_handlers";
import { registerReleaseNoteHandlers } from "./handlers/release_note_handlers";
import { registerImportHandlers } from "./handlers/import_handlers";
import { registerSessionHandlers } from "./handlers/session_handlers";
import { registerProHandlers } from "./handlers/pro_handlers";
import { registerContextPathsHandlers } from "./handlers/context_paths_handlers";
import { registerAppUpgradeHandlers } from "./handlers/app_upgrade_handlers";
import { registerCapacitorHandlers } from "./handlers/capacitor_handlers";
import { registerProblemsHandlers } from "./handlers/problems_handlers";
import { registerAppEnvVarsHandlers } from "./handlers/app_env_vars_handlers";
import { registerTemplateHandlers } from "./handlers/template_handlers";
import { registerPortalHandlers } from "./handlers/portal_handlers";
import { registerPromptHandlers } from "./handlers/prompt_handlers";
import { registerHelpBotHandlers } from "./handlers/help_bot_handlers";
import { registerMcpHandlers } from "./handlers/mcp_handlers";
import { registerSecurityHandlers } from "./handlers/security_handlers";
import { registerVisualEditingHandlers } from "../pro/main/ipc/handlers/visual_editing_handlers";
import { registerAgentToolHandlers } from "../pro/main/ipc/handlers/local_agent/agent_tool_handlers";
import { registerAgentBuilderHandlers } from "./handlers/agent_builder_handlers";
import { registerAgentExportHandlers } from "./handlers/agent_export_handlers";
import { registerN8nHandlers } from "./handlers/n8n_handlers";
import { registerTrustlessInferenceHandlers } from "./handlers/trustless_inference_handlers";
import { registerLibreOfficeHandlers } from "./handlers/libreoffice_handlers";
import { registerMarketplaceHandlers } from "./handlers/marketplace_handlers";
import { registerMarketplaceSyncHandlers } from "./handlers/marketplace_sync_handlers";
import { registerScraperHandlers } from "./handlers/scraper_handlers";
import { registerAssetStudioHandlers } from "./handlers/asset_studio_handlers";
import { registerNFTHandlers } from "./handlers/nft_handlers";
import { registerFederationHandlers } from "./handlers/federation_handlers";
import { registerSovereignDataHandlers } from "./handlers/sovereign_data_handlers";
import { registerIpldReceiptHandlers } from "./handlers/ipld_receipt_handlers";
import { registerDecentralizedDeployHandlers } from "./handlers/decentralized_deploy_handlers";
import { registerProjectHandlers } from "./handlers/project_handlers";
import { registerHybridBridgeHandlers } from "./handlers/hybrid_bridge_handlers";
import { registerDecentralizedChatHandlers } from "./handlers/decentralized_chat_handlers";
import { registerComputeNetworkHandlers } from "./handlers/compute_network_handlers";
import { registerWebRTCHandlers } from "./handlers/webrtc_handlers";
import { registerDatasetStudioHandlers } from "./handlers/dataset_studio_handlers";
import { registerDataStudioCoreHandlers } from "./handlers/data_studio_core_handlers";
import { registerDataVaultHandlers } from "./handlers/data_vault_handlers";
import { registerMediaPipelineHandlers } from "./handlers/media_pipeline_handlers";
import { registerQualityAnalysisHandlers } from "./handlers/quality_analysis_handlers";
import { registerPolicyEngineHandlers } from "./handlers/policy_engine_handlers";
import { registerFullTextSearchHandlers } from "./handlers/fulltext_search_handlers";
import { registerDataGenerationHandlers } from "./handlers/data_generation_handlers";
import { registerDataScrapingHandlers } from "./handlers/data_scraping_handlers";
import { registerDataTransformationHandlers } from "./handlers/data_transformation_handlers";
import { registerAnnotationSystemHandlers } from "./handlers/annotation_system_handlers";
import { registerVersionControlHandlers } from "./handlers/version_control_handlers";
import { registerDataLineageHandlers } from "./handlers/data_lineage_handlers";
import { registerPipelineAutomationHandlers } from "./handlers/pipeline_automation_handlers";
import { registerAnalyticsReportingHandlers } from "./handlers/analytics_reporting_handlers";
import { registerSchemaValidationHandlers } from "./handlers/schema_validation_handlers";
import { registerOrchestratorCoreHandlers } from "./handlers/orchestrator_core_handlers";
import { registerAgentBuilderSystemHandlers } from "./handlers/agent_builder_system_handlers";
import { registerTaskExecutionHandlers } from "./handlers/task_execution_handlers";
import { registerN8nIntegrationHandlers } from "./handlers/n8n_integration_handlers";
import { registerJcnHandlers } from "./handlers/jcn_handlers";
import { registerSmartRouterHandlers } from "./handlers/smart_router_handlers";
import { registerVoiceAssistantHandlers } from "./handlers/voice_assistant_handlers";
import { registerMemorySystemHandlers } from "./handlers/memory_system_handlers";
import { registerPluginHandlers } from "./handlers/plugin_handlers";
import { registerBenchmarkHandlers } from "./handlers/benchmark_handlers";
import { registerCodingAgentHandlers } from "./handlers/coding_agent_handlers";
import { registerDesignSystemHandlers } from "./handlers/design_system_handlers";
import { registerSecretsVaultHandlers } from "./handlers/secrets_vault_handlers";
import { registerOfflineDocsHandlers } from "./handlers/offline_docs_handlers";
import { registerAILearningHandlers } from "./handlers/ai_learning_handlers";
import { registerAgentSwarmHandlers } from "./handlers/agent_swarm_handlers";
import { registerAutonomousAgentHandlers } from "./handlers/autonomous_agent_handlers";
import { registerAutonomousAgentProductionHandlers } from "./handlers/autonomous_agent_production_handlers";
import { registerModelFactoryHandlers } from "./handlers/model_factory_handlers";
import { registerAgentFactoryHandlers } from "./handlers/agent_factory_handlers";
import { registerPrivacyInferenceHandlers } from "./handlers/privacy_inference_handlers";
import { registerDeployedContractHandlers } from "./handlers/deployed_contract_handlers";
import { registerHyperLiquidHandlers } from "./handlers/hyper_liquid_handlers";
import { registerDataSovereigntyHandlers } from "./handlers/data_sovereignty_handlers";
import { registerOpenClawHandlers } from "./handlers/openclaw_handlers";
import { registerOpenClawIPCHandlers } from "./handlers/openclaw_ipc_handlers";
import { registerOpenClawCNSHandlers } from "./handlers/openclaw_cns_handlers";
import { registerStudioAIHandlers } from "./handlers/studio_ai_handlers";
import { registerServicesHandlers } from "./handlers/services_handlers";
import { registerCelestiaBlobHandlers } from "./handlers/celestia_blob_handlers";
import { registerLifecycleHandlers } from "./handlers/lifecycle_handlers";
import { registerLocalVaultHandlers } from "./handlers/local_vault_handlers";
import { registerScrapingV2Handlers } from "./handlers/scraping/handler";
import { registerVectorStoreHandlers } from "./handlers/vector_store_handlers";
import { registerEmbeddingPipelineHandlers } from "./handlers/embedding_pipeline_handlers";
import { registerModelDownloadManagerHandlers } from "./handlers/model_download_manager_handlers";
import { registerMABHandlers } from "./handlers/mab_handlers";
import { registerAgentMemoryHandlers } from "./handlers/agent_memory_handlers";
import { registerAgentStackHandlers } from "./handlers/agent_stack_handlers";
import { registerAgentOrchestratorHandlers } from "./handlers/agent_orchestrator_handlers";
import { registerAgentWorkspaceHandlers } from "./handlers/agent_workspace_handlers";
import { registerAgentCreationHandlers } from "./handlers/agent_creation_handlers";
import { registerAgentUIHandlers } from "./handlers/agent_ui_handlers";

export function registerIpcHandlers() {
  // Register all IPC handlers by category
  registerAppHandlers();
  registerChatHandlers();
  registerChatStreamHandlers();
  registerSettingsHandlers();
  registerShellHandlers();
  registerDependencyHandlers();
  registerGithubHandlers();
  registerVercelHandlers();
  registerNodeHandlers();
  registerProblemsHandlers();
  registerProposalHandlers();
  registerDebugHandlers();
  registerSupabaseHandlers();
  registerNeonHandlers();
  registerLocalModelHandlers();
  registerTokenCountHandlers();
  registerWindowHandlers();
  registerUploadHandlers();
  registerVersionHandlers();
  registerLanguageModelHandlers();
  registerReleaseNoteHandlers();
  registerImportHandlers();
  registerSessionHandlers();
  registerProHandlers();
  registerContextPathsHandlers();
  registerAppUpgradeHandlers();
  registerCapacitorHandlers();
  registerAppEnvVarsHandlers();
  registerTemplateHandlers();
  registerPortalHandlers();
  registerPromptHandlers();
  registerHelpBotHandlers();
  registerMcpHandlers();
  registerSecurityHandlers();
  registerVisualEditingHandlers();
  registerAgentToolHandlers();
  registerAgentBuilderHandlers();
  registerAgentExportHandlers();
  registerN8nHandlers();
  registerTrustlessInferenceHandlers();
  registerLibreOfficeHandlers();
  registerMarketplaceHandlers();
  registerMarketplaceSyncHandlers();
  registerScraperHandlers();
  registerAssetStudioHandlers();
  registerNFTHandlers();
  registerFederationHandlers();
  registerSovereignDataHandlers();
  registerIpldReceiptHandlers();
  registerDecentralizedDeployHandlers();
  registerProjectHandlers();
  registerHybridBridgeHandlers();
  registerDecentralizedChatHandlers();
  registerComputeNetworkHandlers();
  registerWebRTCHandlers();
  registerDatasetStudioHandlers();
  
  // Extended Data Studio handlers
  registerDataStudioCoreHandlers();
  registerDataVaultHandlers();
  registerMediaPipelineHandlers();
  registerQualityAnalysisHandlers();
  registerPolicyEngineHandlers();
  registerFullTextSearchHandlers();
  registerDataGenerationHandlers();
  registerDataScrapingHandlers();
  registerDataTransformationHandlers();
  
  // Advanced Data Studio handlers (Phase 3-4)
  registerAnnotationSystemHandlers();
  registerVersionControlHandlers();
  registerDataLineageHandlers();
  registerPipelineAutomationHandlers();
  registerAnalyticsReportingHandlers();
  registerSchemaValidationHandlers();
  
  // Orchestrator & Agent System handlers
  registerOrchestratorCoreHandlers();
  registerAgentBuilderSystemHandlers();
  registerTaskExecutionHandlers();
  registerN8nIntegrationHandlers();
  
  // JoyCreate Node (JCN) - Local Asset Publishing & Inference
  registerJcnHandlers();
  
  // Smart Router - Intelligent Local/Cloud Routing
  registerSmartRouterHandlers();
  
  // Voice Assistant - Speech-to-text and text-to-speech
  registerVoiceAssistantHandlers();
  
  // Memory System - Persistent AI memory across sessions
  registerMemorySystemHandlers();
  
  // Plugin System - Plugin marketplace and management
  registerPluginHandlers();
  
  // Model Benchmark - Performance testing for local models
  registerBenchmarkHandlers();
  
  // AI Coding Agent - Autonomous code generation and editing
  registerCodingAgentHandlers();
  
  // Design System Generator - Auto-generate component libraries
  registerDesignSystemHandlers();
  
  // Secrets Vault - Secure local credential storage
  registerSecretsVaultHandlers();
  
  // Offline Docs Hub - Searchable offline documentation
  registerOfflineDocsHandlers();
  
  // AI Learning Mode - Personalized AI behavior learning
  registerAILearningHandlers();
  
  // Agent Swarm System - Self-replicating agent orchestration
  registerAgentSwarmHandlers();
  
  // Autonomous Agent System - Fully autonomous AI agents
  registerAutonomousAgentHandlers();
  
  // Autonomous Agent Production - Resource monitoring, security, scheduling, backups
  registerAutonomousAgentProductionHandlers();
  
  // Model Factory - LoRA/QLoRA training for low GPU systems
  registerModelFactoryHandlers();
  
  // Agent Factory - Custom AI agent creation and training
  registerAgentFactoryHandlers();
  
  // Privacy-Preserving Inference Bridge - Local-first AI with federated fallback
  registerPrivacyInferenceHandlers();

  // Deployed Contracts & NFT-Gated Inference Access Control
  registerDeployedContractHandlers();

  // Hyper Liquid Data Pipeline - Local to Marketplace Flow
  registerHyperLiquidHandlers();

  // Data Sovereignty & Monetization - Complete data protection
  registerDataSovereigntyHandlers();

  // OpenClaw Gateway - Local AI Gateway with n8n integration
  // Supports Ollama (local), Anthropic (cloud), and Claude Code (agentic)
  registerOpenClawHandlers();

  // OpenClaw Integration - Personal AI Assistant (Central Nervous System)
  // Multi-channel messaging, AI agents, memory, plugins
  // 🦞 EXFOLIATE! EXFOLIATE!
  registerOpenClawIPCHandlers();

  // OpenClaw CNS - Central Nervous System with Ollama & N8n integration
  // Unified AI routing: Ollama (local) ↔ Cloud (Anthropic) with N8n automation
  // 🦞 The brain that coordinates everything!
  registerOpenClawCNSHandlers();

  // Studio AI Service - Claude Code + Ollama integration across all studios
  // Data Studio, Document Studio, Asset Studio, Agent Swarms, Dataset Studio
  registerStudioAIHandlers();

  // External Services Manager - n8n, Celestia, Ollama
  // Start/stop background services from the UI
  registerServicesHandlers();

  // Celestia Blob DA Layer - Hash-first data availability
  // Large data → SHA-256 hash → encrypted blob → Celestia namespace
  registerCelestiaBlobHandlers();

  // Creator Lifecycle Engine — Create → Verify → Use → Receipts → Rewards → Reputation → Better Create
  registerLifecycleHandlers();

  // Local Vault — Sovereign local-first data vault
  // Ingest → Transform → Package → Publish (encrypted only)
  registerLocalVaultHandlers();

  // Scraping Engine v2 — Best-in-class web scraping with cheerio, Playwright, AI extraction, auto-tagging
  registerScrapingV2Handlers();

  // Vector Store — sqlite-vec powered local vector search & RAG
  registerVectorStoreHandlers();

  // Embedding Pipeline — chunk → embed (Ollama) → store (sqlite-vec) → retrieve for RAG
  registerEmbeddingPipelineHandlers();

  // Model Download Manager — GPU detection, model catalog, Ollama pull/delete
  registerModelDownloadManagerHandlers();

  // Multi-Armed Bandit Learning — Thompson Sampling for continuous improvement
  // Select → Use → Reward → Learn → Better Select
  registerMABHandlers();

  // Agent Memory — Long-Term (cross-conversation) + Short-Term (per-conversation)
  registerAgentMemoryHandlers();

  // Agent Stack Builder — Triggers (Gmail/Slack/Sheets), Tool Catalog, n8n Workflows
  registerAgentStackHandlers();

  // Agent Orchestrator — Autonomous meta-agent orchestration (Swarm + Autonomous + Factory + CNS + Voice)
  registerAgentOrchestratorHandlers();

  // Agent Workspace — Per-agent task management, knowledge sources, and execution engine
  registerAgentWorkspaceHandlers();

  // Agent Creation Pipeline — NLP Chat → Intent Detection → Blueprint → Auto-Setup
  registerAgentCreationHandlers();

  // Agent UI Builder — Generate agent interfaces from templates and configuration
  registerAgentUIHandlers();
}
