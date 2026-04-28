/**
 * Joy Assistant Types
 *
 * Types for the AI-powered platform assistant that helps users navigate,
 * create, fill forms, search the marketplace, and understand JoyCreate.
 *
 * Two interaction modes:
 *  - "do-it-for-me": The assistant directly fills fields, clicks buttons, navigates
 *  - "guide-me": The assistant highlights elements, shows tooltips, gives instructions
 */

// ============================================================================
// Core Enums & Modes
// ============================================================================

/** Classified intent of the user's message */
export type AssistantIntent =
  | "navigate"     // Go to a page/route
  | "explain"      // Explain a feature or concept
  | "fill"         // Fill in form fields
  | "create"       // Create a document, agent, workflow, etc.
  | "search"       // Search marketplace, library, or knowledge base
  | "configure"    // Change settings or preferences
  | "analyze"      // Analyze data, assets, or performance
  | "system"       // System-level operations (files, commands, apps)
  | "general";     // General conversation / catch-all

/** User-selected interaction mode */
export type AssistantMode = "auto" | "do-it-for-me" | "guide-me";

// ============================================================================
// Actions — Commands the assistant sends to the renderer for execution
// ============================================================================

export interface NavigateAction {
  type: "navigate";
  route: string;
  label: string;
}

export interface FillFieldAction {
  type: "fill";
  /** data-joy-assist attribute value identifying the target element */
  fieldId: string;
  /** Value to fill */
  value: string;
  /** Human-readable field label */
  label: string;
}

export interface ClickAction {
  type: "click";
  /** data-joy-assist attribute value */
  targetId: string;
  label: string;
}

export interface HighlightAction {
  type: "highlight";
  /** data-joy-assist attribute value */
  targetId: string;
  label: string;
  /** Optional tooltip text shown next to the element */
  tooltip?: string;
  /** Duration in ms before auto-removing highlight (default: 3000) */
  durationMs?: number;
}

export interface ShowTooltipAction {
  type: "tooltip";
  /** data-joy-assist attribute value to anchor the tooltip near */
  targetId: string;
  content: string;
  durationMs?: number;
}

export interface CreateDocumentAction {
  type: "create-document";
  documentType: "document" | "spreadsheet" | "presentation";
  name: string;
  /** Optional AI generation prompt */
  aiPrompt?: string;
}

export interface SearchAction {
  type: "search";
  /** Where to search */
  target: "marketplace" | "library" | "knowledge-base" | "agents" | "workflows";
  query: string;
}

export interface OpenDialogAction {
  type: "open-dialog";
  /** Dialog identifier — components listen for this via custom events */
  dialogId: string;
  label: string;
}

// ============================================================================
// System-Level Actions — OpenClaw-style capabilities
// ============================================================================

export interface RunCommandAction {
  type: "run-command";
  /** Shell command to execute */
  command: string;
  /** Working directory (default: user home) */
  cwd?: string;
  label: string;
  /** If true, requires explicit user approval before execution */
  requiresApproval?: boolean;
}

export interface ReadFileAction {
  type: "read-file";
  /** Absolute path to the file */
  filePath: string;
  label: string;
}

export interface WriteFileAction {
  type: "write-file";
  /** Absolute path for the file */
  filePath: string;
  /** Content to write */
  content: string;
  label: string;
  requiresApproval?: boolean;
}

export interface ListDirectoryAction {
  type: "list-directory";
  /** Absolute path to directory */
  dirPath: string;
  label: string;
}

export interface OpenAppAction {
  type: "open-app";
  /** Application name or path */
  appName: string;
  /** Arguments to pass */
  args?: string[];
  label: string;
}

export interface OpenUrlAction {
  type: "open-url";
  url: string;
  label: string;
}

export interface SystemInfoAction {
  type: "system-info";
  /** What info to retrieve: "os", "hardware", "processes", "disk", "memory", "network" */
  infoType: "os" | "hardware" | "processes" | "disk" | "memory" | "network";
  label: string;
}

/** Union of all possible actions */
export type AssistantAction =
  | NavigateAction
  | FillFieldAction
  | ClickAction
  | HighlightAction
  | ShowTooltipAction
  | CreateDocumentAction
  | SearchAction
  | OpenDialogAction
  | RunCommandAction
  | ReadFileAction
  | WriteFileAction
  | ListDirectoryAction
  | OpenAppAction
  | OpenUrlAction
  | SystemInfoAction;

// ============================================================================
// Messages & Sessions
// ============================================================================

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Actions proposed/executed with this message */
  actions?: AssistantAction[];
  /** Classified intent (assistant messages only) */
  intent?: AssistantIntent;
  timestamp: number;
  /** Which provider/model was used (assistant messages only) */
  routingInfo?: {
    providerId: string;
    modelId: string;
    isLocal: boolean;
  };
}

export interface AssistantSession {
  id: string;
  messages: AssistantMessage[];
  mode: AssistantMode;
  createdAt: number;
}

// ============================================================================
// Page Context — Sent from renderer to describe the current page
// ============================================================================

export interface PageElementInfo {
  id: string;
  type: "input" | "button" | "link" | "section" | "dialog";
  label: string;
}

export interface AssistantPageContext {
  /** Current TanStack Router path, e.g. "/marketplace" */
  route: string;
  /** Derived page title */
  pageTitle: string;
  /** List of data-joy-assist elements found on the page */
  availableElements: PageElementInfo[];
  /** Currently focused element's data-joy-assist ID, if any */
  activeElement?: string;
}

// ============================================================================
// Suggestions — Proactive tips shown based on current page
// ============================================================================

export interface AssistantSuggestion {
  id: string;
  text: string;
  intent: AssistantIntent;
  /** Higher = shown first */
  priority: number;
}

// ============================================================================
// Streaming — IPC stream protocol
// ============================================================================

export interface AssistantStreamChunk {
  sessionId: string;
  /** Text delta (incremental) */
  delta?: string;
  /** Actions determined so far (sent with the final chunk or incrementally) */
  actions?: AssistantAction[];
  /** True when stream is complete */
  done: boolean;
  /** Error message if stream failed */
  error?: string;
}

// ============================================================================
// IPC Request/Response shapes
// ============================================================================

export interface AssistantChatRequest {
  sessionId: string;
  message: string;
  pageContext: AssistantPageContext;
  mode: AssistantMode;
  /**
   * Optional explicit model override. When provided, the assistant uses this
   * exact model and skips the local-first auto-resolution. `provider: "auto"`
   * is treated the same as omitting this field.
   */
  model?: { provider: string; name: string };
}

export interface AssistantSuggestionsRequest {
  pageContext: AssistantPageContext;
}

export interface AssistantExecuteActionRequest {
  sessionId: string;
  action: AssistantAction;
}
