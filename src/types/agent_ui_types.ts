/**
 * Agent UI Types
 * Types for the agent UI builder system that generates
 * complete agent UIs leveraging the existing app builder infrastructure.
 */

import type { AgentType } from "@/db/schema";
import type {
  ComponentType,
  AppComponent,
  ComponentStyles,
  ComponentEvent,
  AppPage,
} from "@/types/sovereign_stack_types";

// =============================================================================
// AGENT UI COMPONENT TYPES
// =============================================================================

/** UI layout style for agent interface */
export type AgentUILayout =
  | "chat-standard" // Classic chat interface
  | "chat-sidebar" // Chat with sidebar for context/tools
  | "dashboard" // Cards/widgets for task agents
  | "workflow-canvas" // Visual workflow display
  | "split-panel" // Input/Output split view
  | "wizard" // Multi-step form flow
  | "embedded" // Embeddable widget for other apps
  | "custom";

/** Agent UI theme */
export type AgentUITheme = "light" | "dark" | "system" | "custom";

/** Pre-built component blocks for agent UIs */
export type AgentUIBlock =
  | "chat-input" // Text input + send button
  | "chat-messages" // Message list with user/assistant bubbles
  | "tool-result" // Tool execution result card
  | "knowledge-card" // Knowledge source preview
  | "task-list" // List of tasks with status
  | "task-card" // Individual task card
  | "workflow-diagram" // n8n-style workflow visualization
  | "metrics-panel" // Usage/performance metrics
  | "settings-panel" // Agent configuration UI
  | "file-upload" // File/document upload zone
  | "voice-input" // Voice input button
  | "quick-actions" // Preset action buttons
  | "context-sidebar" // Contextual information sidebar
  | "agent-avatar" // Agent avatar/identity display
  | "streaming-indicator" // Typing/thinking indicator
  | "error-banner"; // Error display

// =============================================================================
// AGENT UI CONFIGURATION
// =============================================================================

export interface AgentUIConfig {
  /** Layout style */
  layout: AgentUILayout;

  /** Theme settings */
  theme: AgentUITheme;
  customColors?: AgentUIColors;

  /** Which blocks to include */
  blocks: AgentUIBlockConfig[];

  /** Branding */
  branding?: AgentUIBranding;

  /** Behavior */
  behavior?: AgentUIBehavior;

  /** Responsive breakpoints */
  responsive?: AgentUIResponsive;
}

export interface AgentUIColors {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  userBubble: string;
  assistantBubble: string;
}

export interface AgentUIBlockConfig {
  block: AgentUIBlock;
  enabled: boolean;
  position?: "header" | "main" | "sidebar" | "footer";
  order?: number;
  customProps?: Record<string, unknown>;
  customStyles?: Partial<ComponentStyles>;
}

export interface AgentUIBranding {
  agentName?: string;
  agentDescription?: string;
  agentAvatar?: string;
  welcomeMessage?: string;
  placeholderText?: string;
  headerTitle?: string;
  footerText?: string;
  logoUrl?: string;
}

export interface AgentUIBehavior {
  /** Auto-scroll to new messages */
  autoScroll: boolean;
  /** Show typing indicator */
  showTypingIndicator: boolean;
  /** Enable voice input */
  enableVoiceInput: boolean;
  /** Enable file uploads */
  enableFileUpload: boolean;
  /** Show tool executions in real-time */
  showToolExecutions: boolean;
  /** Allow message editing */
  allowMessageEdit: boolean;
  /** Allow message deletion */
  allowMessageDelete: boolean;
  /** Show timestamps */
  showTimestamps: boolean;
  /** Enable markdown rendering */
  enableMarkdown: boolean;
  /** Enable code highlighting */
  enableCodeHighlight: boolean;
  /** Persist conversation history */
  persistHistory: boolean;
  /** Max messages to show */
  maxVisibleMessages?: number;
}

export interface AgentUIResponsive {
  /** Mobile breakpoint */
  mobileBreakpoint: number;
  /** Tablet breakpoint */
  tabletBreakpoint: number;
  /** Collapse sidebar on mobile */
  collapseSidebarOnMobile: boolean;
  /** Stack layout on mobile */
  stackOnMobile: boolean;
}

// =============================================================================
// AGENT UI GENERATION
// =============================================================================

/** Input for generating agent UI */
export interface GenerateAgentUIRequest {
  agentId: number | string;
  agentName?: string;
  agentType: AgentType;
  agentDescription?: string;

  /** UI preferences */
  config: Partial<AgentUIConfig>;

  /** Tools the agent has (affects UI blocks) */
  tools?: Array<{ name: string; description?: string }>;

  /** Knowledge sources (affects sidebar) */
  knowledgeSources?: Array<{ name: string; type: string; id?: string }>;

  /** Optional existing app ID to add pages to */
  existingAppId?: number;
}

/** Result of UI generation */
export interface GenerateAgentUIResult {
  /** Generated app ID */
  appId: number | string;

  /** Generated pages */
  pages: AgentUIPage[];

  /** Generated components (flattened) */
  components: AppComponent[];

  /** Preview URL */
  previewUrl?: string;

  /** Export formats available */
  exportFormats: ("react" | "vue" | "html")[];
}

export interface AgentUIPage {
  id: string;
  name: string;
  path: string;
  layout: AgentUILayout;
  blocks: AgentUIBlock[];
  components: AppComponent[];
}

// =============================================================================
// AGENT UI TEMPLATES
// =============================================================================

export interface AgentUITemplate {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  forAgentTypes: AgentType[];
  layout: AgentUILayout;
  defaultConfig: AgentUIConfig;
  previewComponents: AppComponent[];
}

// =============================================================================
// CHATBOT-SPECIFIC UI TYPES
// =============================================================================

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ChatToolCall[];
  attachments?: ChatAttachment[];
  isStreaming?: boolean;
  error?: string;
}

export interface ChatToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: number;
  completedAt?: number;
}

export interface ChatAttachment {
  id: string;
  type: "file" | "image" | "document";
  name: string;
  url?: string;
  mimeType?: string;
  size?: number;
}

// =============================================================================
// DASHBOARD-SPECIFIC UI TYPES
// =============================================================================

export interface DashboardWidget {
  id: string;
  type: "metric" | "chart" | "task-list" | "recent-activity" | "quick-actions";
  title: string;
  gridPosition: { x: number; y: number; w: number; h: number };
  config: Record<string, unknown>;
}

export interface DashboardLayout {
  columns: number;
  rowHeight: number;
  widgets: DashboardWidget[];
}

// =============================================================================
// WORKFLOW UI TYPES
// =============================================================================

export interface WorkflowNode {
  id: string;
  type: "trigger" | "action" | "condition" | "loop" | "agent" | "output";
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
}

export interface WorkflowUIConfig {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  zoom: number;
  pan: { x: number; y: number };
}
