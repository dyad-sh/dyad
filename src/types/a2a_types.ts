/**
 * Agent-to-Agent (A2A) Communication Protocol Types
 * 
 * Enables agents to discover, negotiate, and transact with each other
 * across the decentralized network. This is the nervous system of the
 * agentic web — where agents become first-class economic actors.
 * 
 * Based on Google A2A + MCP interop principles, adapted for sovereign AI.
 */

// =============================================================================
// AGENT IDENTITY & REGISTRATION
// =============================================================================

export interface AgentCard {
  /** Unique agent identifier (DID-based) */
  agentId: string;
  /** DID of the agent owner */
  ownerDid: string;
  /** Human-readable name */
  name: string;
  /** Description of what the agent does */
  description: string;
  /** Agent version */
  version: string;
  /** Agent icon/avatar URL or CID */
  avatarUrl?: string;
  
  /** Capabilities this agent offers */
  capabilities: AgentCapability[];
  /** Pricing for each capability */
  pricing: AgentPricing[];
  /** MCP tools this agent exposes */
  mcpTools?: MCPToolDeclaration[];
  /** Input/output schemas */
  schemas: AgentSchemas;
  
  /** Network endpoints where this agent can be reached */
  endpoints: AgentEndpoint[];
  /** Authentication methods supported */
  authMethods: AuthMethod[];
  
  /** Reputation score (from reputation engine) */
  reputationScore: number;
  /** Trust tier */
  trustTier: "newcomer" | "contributor" | "trusted" | "verified" | "elite";
  /** Total completed tasks */
  totalTasksCompleted: number;
  /** Average response time in ms */
  avgResponseMs: number;
  /** Uptime percentage */
  uptimePercent: number;
  
  /** When this card was last updated */
  updatedAt: number;
  /** When this agent was first registered */
  registeredAt: number;
  /** Signature proving ownership */
  signature: string;
}

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  category: AgentCapabilityCategory;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  maxTokensPerRequest?: number;
  estimatedLatencyMs?: number;
  supportedModels?: string[];
}

export type AgentCapabilityCategory =
  | "text-generation"
  | "text-analysis"
  | "image-generation"
  | "image-analysis"
  | "code-generation"
  | "code-review"
  | "data-processing"
  | "data-analysis"
  | "web-scraping"
  | "api-integration"
  | "document-generation"
  | "translation"
  | "summarization"
  | "classification"
  | "recommendation"
  | "search"
  | "conversation"
  | "task-automation"
  | "workflow-orchestration"
  | "custom";

export interface AgentPricing {
  capabilityId: string;
  model: PricingModel;
  amount: string; // In smallest token unit
  currency: string; // "JOY", "USDC", etc.
  /** For subscription model */
  intervalMs?: number;
  /** For per-token model */
  perInputToken?: string;
  perOutputToken?: string;
}

export type PricingModel =
  | "free"
  | "per-call"
  | "per-token"
  | "per-minute"
  | "subscription"
  | "negotiable";

export interface MCPToolDeclaration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface AgentSchemas {
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export interface AgentEndpoint {
  type: "http" | "ws" | "libp2p" | "grpc";
  url: string;
  priority: number; // Lower = preferred
  healthy: boolean;
  lastChecked: number;
}

export type AuthMethod =
  | "did-auth"        // DID-based authentication
  | "api-key"         // Simple API key
  | "jwt"             // JWT bearer token
  | "wallet-sig"      // Wallet signature challenge
  | "none";           // Public/free access

// =============================================================================
// AGENT DISCOVERY
// =============================================================================

export interface AgentRegistryEntry {
  agentId: string;
  card: AgentCard;
  /** IPFS CID of the full agent card */
  cardCid?: string;
  /** Index of searchable tags */
  tags: string[];
  /** Categories for browsing */
  categories: AgentCapabilityCategory[];
  /** Network this agent is on */
  network: string;
  /** Is this agent currently online? */
  online: boolean;
  /** Last seen timestamp */
  lastSeen: number;
  /** Registration timestamp */
  registeredAt: number;
}

export interface AgentSearchQuery {
  /** Text search across name, description, capabilities */
  query?: string;
  /** Filter by capability categories */
  categories?: AgentCapabilityCategory[];
  /** Filter by pricing model */
  pricingModel?: PricingModel[];
  /** Filter by minimum reputation score */
  minReputation?: number;
  /** Filter by minimum trust tier */
  minTrustTier?: string;
  /** Filter by maximum price */
  maxPrice?: string;
  /** Filter by currency */
  currency?: string;
  /** Filter by online status */
  onlineOnly?: boolean;
  /** Filter by capabilities */
  capabilities?: string[];
  /** Sort by */
  sortBy?: "reputation" | "price" | "latency" | "uptime" | "tasks_completed" | "newest";
  /** Sort direction */
  sortDir?: "asc" | "desc";
  /** Pagination */
  offset?: number;
  limit?: number;
}

export interface AgentSearchResult {
  agents: AgentRegistryEntry[];
  total: number;
  offset: number;
  limit: number;
}

// =============================================================================
// A2A MESSAGING PROTOCOL
// =============================================================================

export type A2AMessageType =
  | "task-request"       // Request agent to perform a task
  | "task-response"      // Response to a task request
  | "task-status"        // Status update on an ongoing task
  | "task-cancel"        // Cancel an ongoing task
  | "capability-query"   // Query agent capabilities
  | "capability-response"// Response with capabilities
  | "negotiate-price"    // Price negotiation
  | "negotiate-accept"   // Accept negotiation
  | "negotiate-reject"   // Reject negotiation
  | "negotiate-counter"  // Counter-offer
  | "payment-initiated"  // Payment has been sent
  | "payment-confirmed"  // Payment confirmed
  | "mcp-tool-call"      // Cross-agent MCP tool invocation
  | "mcp-tool-result"    // Result of MCP tool call
  | "heartbeat"          // Agent alive check
  | "error";             // Error message

export interface A2AMessage {
  /** Unique message ID */
  id: string;
  /** Message type */
  type: A2AMessageType;
  /** Sender agent ID (DID-based) */
  from: string;
  /** Recipient agent ID (DID-based) */
  to: string;
  /** Conversation/task thread ID */
  threadId: string;
  /** Reference to previous message in thread */
  inReplyTo?: string;
  
  /** Message payload (type-specific) */
  payload: A2APayload;
  
  /** Sender's DID signature */
  signature: string;
  /** Timestamp */
  timestamp: number;
  /** TTL in ms (message expires after this) */
  ttlMs?: number;
  /** Priority */
  priority: "low" | "normal" | "high" | "urgent";
}

export type A2APayload =
  | TaskRequestPayload
  | TaskResponsePayload
  | TaskStatusPayload
  | TaskCancelPayload
  | CapabilityQueryPayload
  | CapabilityResponsePayload
  | NegotiatePayload
  | PaymentPayload
  | MCPToolCallPayload
  | MCPToolResultPayload
  | HeartbeatPayload
  | ErrorPayload;

export interface TaskRequestPayload {
  kind: "task-request";
  taskId: string;
  capabilityId: string;
  input: Record<string, unknown>;
  maxBudget?: string;
  currency?: string;
  deadlineMs?: number;
  requireVerification?: boolean;
}

export interface TaskResponsePayload {
  kind: "task-response";
  taskId: string;
  status: "accepted" | "rejected" | "completed" | "failed";
  output?: Record<string, unknown>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    computeMs: number;
  };
  cost?: string;
  currency?: string;
  rejectionReason?: string;
  failureReason?: string;
  verificationCid?: string;
}

export interface TaskStatusPayload {
  kind: "task-status";
  taskId: string;
  status: "queued" | "running" | "streaming" | "completed" | "failed" | "cancelled";
  progress?: number; // 0-100
  estimatedCompletionMs?: number;
  partialOutput?: Record<string, unknown>;
}

export interface TaskCancelPayload {
  kind: "task-cancel";
  taskId: string;
  reason?: string;
}

export interface CapabilityQueryPayload {
  kind: "capability-query";
  categories?: AgentCapabilityCategory[];
  specificCapabilities?: string[];
}

export interface CapabilityResponsePayload {
  kind: "capability-response";
  capabilities: AgentCapability[];
  pricing: AgentPricing[];
}

export interface NegotiatePayload {
  kind: "negotiate-price" | "negotiate-accept" | "negotiate-reject" | "negotiate-counter";
  taskId: string;
  capabilityId: string;
  proposedPrice?: string;
  currency?: string;
  reason?: string;
}

export interface PaymentPayload {
  kind: "payment-initiated" | "payment-confirmed";
  taskId: string;
  amount: string;
  currency: string;
  txHash?: string;
  network?: string;
}

export interface MCPToolCallPayload {
  kind: "mcp-tool-call";
  toolName: string;
  arguments: Record<string, unknown>;
  requestId: string;
}

export interface MCPToolResultPayload {
  kind: "mcp-tool-result";
  requestId: string;
  result?: unknown;
  error?: string;
}

export interface HeartbeatPayload {
  kind: "heartbeat";
  status: "online" | "busy" | "maintenance";
  load?: number; // 0-100
}

export interface ErrorPayload {
  kind: "error";
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// =============================================================================
// A2A TASKS (Cross-Agent Work)
// =============================================================================

export type A2ATaskStatus =
  | "created"
  | "negotiating"
  | "accepted"
  | "payment_pending"
  | "payment_confirmed"
  | "running"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled"
  | "disputed";

export interface A2ATask {
  id: string;
  threadId: string;
  
  /** Requesting agent */
  requesterId: string;
  /** Executing agent */
  executorId: string;
  
  /** Capability being invoked */
  capabilityId: string;
  
  /** Input data */
  input: Record<string, unknown>;
  /** Output data (when complete) */
  output?: Record<string, unknown>;
  
  /** Agreed price */
  agreedPrice?: string;
  currency?: string;
  
  /** Payment */
  paymentTxHash?: string;
  paymentStatus: "none" | "pending" | "confirmed" | "refunded";
  
  /** Status */
  status: A2ATaskStatus;
  progress: number;
  
  /** Verification */
  verificationCid?: string;
  verified: boolean;
  
  /** Timing */
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  
  /** Messages in this task thread */
  messageCount: number;
}

// =============================================================================
// A2A NETWORK STATS
// =============================================================================

export interface A2ANetworkStats {
  totalRegisteredAgents: number;
  onlineAgents: number;
  totalTasksCompleted: number;
  totalValueTransacted: string;
  avgTaskLatencyMs: number;
  activeTasksNow: number;
  topCategories: { category: AgentCapabilityCategory; count: number }[];
}
