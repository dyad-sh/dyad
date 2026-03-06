/**
 * Agent UI Templates
 * Pre-built UI templates for different agent types and use cases.
 */

import type { AgentType } from "@/db/schema";
import type {
  AgentUITemplate,
  AgentUIConfig,
  AgentUILayout,
  AgentUIBlock,
  AgentUIBlockConfig,
  AgentUIColors,
  AgentUIBehavior,
} from "@/types/agent_ui_types";
import type { AppComponent, ComponentId } from "@/types/sovereign_stack_types";

// =============================================================================
// COLOR THEMES
// =============================================================================

export const UI_THEMES = {
  default: {
    primary: "#3b82f6",
    secondary: "#6b7280",
    background: "#ffffff",
    surface: "#f9fafb",
    text: "#111827",
    textSecondary: "#6b7280",
    border: "#e5e7eb",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    userBubble: "#3b82f6",
    assistantBubble: "#f3f4f6",
  },
  dark: {
    primary: "#60a5fa",
    secondary: "#9ca3af",
    background: "#111827",
    surface: "#1f2937",
    text: "#f9fafb",
    textSecondary: "#9ca3af",
    border: "#374151",
    success: "#34d399",
    warning: "#fbbf24",
    error: "#f87171",
    userBubble: "#3b82f6",
    assistantBubble: "#374151",
  },
  purple: {
    primary: "#8b5cf6",
    secondary: "#a78bfa",
    background: "#faf5ff",
    surface: "#f3e8ff",
    text: "#581c87",
    textSecondary: "#7c3aed",
    border: "#ddd6fe",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    userBubble: "#8b5cf6",
    assistantBubble: "#ede9fe",
  },
  green: {
    primary: "#10b981",
    secondary: "#34d399",
    background: "#ecfdf5",
    surface: "#d1fae5",
    text: "#064e3b",
    textSecondary: "#047857",
    border: "#a7f3d0",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    userBubble: "#10b981",
    assistantBubble: "#d1fae5",
  },
  corporate: {
    primary: "#1e40af",
    secondary: "#3b82f6",
    background: "#f8fafc",
    surface: "#f1f5f9",
    text: "#0f172a",
    textSecondary: "#475569",
    border: "#cbd5e1",
    success: "#059669",
    warning: "#d97706",
    error: "#dc2626",
    userBubble: "#1e40af",
    assistantBubble: "#e2e8f0",
  },
} as const;

// =============================================================================
// AGENT UI TEMPLATES
// =============================================================================

export const AGENT_UI_TEMPLATES: AgentUITemplate[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // CHATBOT TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "chatbot-standard",
    name: "Standard Chat",
    description: "Clean, minimal chat interface with message bubbles",
    forAgentTypes: ["chatbot", "rag"],
    layout: "chat-standard",
    defaultConfig: {
      layout: "chat-standard",
      theme: "light",
      customColors: UI_THEMES.default,
      blocks: [
        { block: "agent-avatar", enabled: true, position: "header" },
        { block: "chat-messages", enabled: true, position: "main" },
        { block: "streaming-indicator", enabled: true, position: "main" },
        { block: "chat-input", enabled: true, position: "footer" },
        { block: "error-banner", enabled: true, position: "main" },
      ],
      behavior: {
        autoScroll: true,
        showTypingIndicator: true,
        enableVoiceInput: false,
        enableFileUpload: false,
        showToolExecutions: false,
        allowMessageEdit: false,
        allowMessageDelete: true,
        showTimestamps: true,
        enableMarkdown: true,
        enableCodeHighlight: true,
        persistHistory: true,
      },
    },
    previewComponents: [],
  },
  {
    id: "chatbot-with-sidebar",
    name: "Chat with Sidebar",
    description: "Chat interface with sidebar for tools and context",
    forAgentTypes: ["chatbot", "rag"],
    layout: "chat-sidebar",
    defaultConfig: {
      layout: "chat-sidebar",
      theme: "light",
      customColors: UI_THEMES.default,
      blocks: [
        { block: "agent-avatar", enabled: true, position: "header" },
        { block: "chat-messages", enabled: true, position: "main" },
        { block: "streaming-indicator", enabled: true, position: "main" },
        { block: "quick-actions", enabled: true, position: "main" },
        { block: "chat-input", enabled: true, position: "footer" },
        { block: "context-sidebar", enabled: true, position: "sidebar" },
        { block: "knowledge-card", enabled: true, position: "sidebar" },
        { block: "error-banner", enabled: true, position: "main" },
      ],
      behavior: {
        autoScroll: true,
        showTypingIndicator: true,
        enableVoiceInput: false,
        enableFileUpload: true,
        showToolExecutions: true,
        allowMessageEdit: false,
        allowMessageDelete: true,
        showTimestamps: true,
        enableMarkdown: true,
        enableCodeHighlight: true,
        persistHistory: true,
      },
    },
    previewComponents: [],
  },
  {
    id: "chatbot-embedded",
    name: "Embedded Widget",
    description: "Compact chat widget for embedding in other apps",
    forAgentTypes: ["chatbot"],
    layout: "embedded",
    defaultConfig: {
      layout: "embedded",
      theme: "light",
      customColors: UI_THEMES.default,
      blocks: [
        { block: "chat-messages", enabled: true, position: "main" },
        { block: "streaming-indicator", enabled: true, position: "main" },
        { block: "chat-input", enabled: true, position: "footer" },
      ],
      behavior: {
        autoScroll: true,
        showTypingIndicator: true,
        enableVoiceInput: false,
        enableFileUpload: false,
        showToolExecutions: false,
        allowMessageEdit: false,
        allowMessageDelete: false,
        showTimestamps: false,
        enableMarkdown: true,
        enableCodeHighlight: false,
        persistHistory: false,
        maxVisibleMessages: 20,
      },
      responsive: {
        mobileBreakpoint: 480,
        tabletBreakpoint: 768,
        collapseSidebarOnMobile: true,
        stackOnMobile: true,
      },
    },
    previewComponents: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TASK AGENT TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "task-dashboard",
    name: "Task Dashboard",
    description: "Dashboard with task list, metrics, and quick actions",
    forAgentTypes: ["task"],
    layout: "dashboard",
    defaultConfig: {
      layout: "dashboard",
      theme: "light",
      customColors: UI_THEMES.corporate,
      blocks: [
        { block: "agent-avatar", enabled: true, position: "header" },
        { block: "metrics-panel", enabled: true, position: "main" },
        { block: "task-list", enabled: true, position: "main" },
        { block: "quick-actions", enabled: true, position: "main" },
        { block: "tool-result", enabled: true, position: "main" },
        { block: "error-banner", enabled: true, position: "main" },
      ],
      behavior: {
        autoScroll: false,
        showTypingIndicator: false,
        enableVoiceInput: false,
        enableFileUpload: true,
        showToolExecutions: true,
        allowMessageEdit: false,
        allowMessageDelete: true,
        showTimestamps: true,
        enableMarkdown: true,
        enableCodeHighlight: true,
        persistHistory: true,
      },
    },
    previewComponents: [],
  },
  {
    id: "task-command-center",
    name: "Command Center",
    description: "Full-featured task management with split view",
    forAgentTypes: ["task"],
    layout: "split-panel",
    defaultConfig: {
      layout: "split-panel",
      theme: "dark",
      customColors: UI_THEMES.dark,
      blocks: [
        { block: "agent-avatar", enabled: true, position: "header" },
        { block: "task-list", enabled: true, position: "sidebar" },
        { block: "task-card", enabled: true, position: "main" },
        { block: "tool-result", enabled: true, position: "main" },
        { block: "chat-input", enabled: true, position: "footer" },
        { block: "error-banner", enabled: true, position: "main" },
      ],
      behavior: {
        autoScroll: true,
        showTypingIndicator: true,
        enableVoiceInput: false,
        enableFileUpload: true,
        showToolExecutions: true,
        allowMessageEdit: false,
        allowMessageDelete: true,
        showTimestamps: true,
        enableMarkdown: true,
        enableCodeHighlight: true,
        persistHistory: true,
      },
    },
    previewComponents: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RAG AGENT TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "rag-research",
    name: "Research Assistant",
    description: "Chat with knowledge sidebar for document sources",
    forAgentTypes: ["rag"],
    layout: "chat-sidebar",
    defaultConfig: {
      layout: "chat-sidebar",
      theme: "light",
      customColors: UI_THEMES.green,
      blocks: [
        { block: "agent-avatar", enabled: true, position: "header" },
        { block: "chat-messages", enabled: true, position: "main" },
        { block: "streaming-indicator", enabled: true, position: "main" },
        { block: "chat-input", enabled: true, position: "footer" },
        { block: "context-sidebar", enabled: true, position: "sidebar" },
        { block: "knowledge-card", enabled: true, position: "sidebar" },
        { block: "file-upload", enabled: true, position: "sidebar" },
        { block: "error-banner", enabled: true, position: "main" },
      ],
      behavior: {
        autoScroll: true,
        showTypingIndicator: true,
        enableVoiceInput: false,
        enableFileUpload: true,
        showToolExecutions: true,
        allowMessageEdit: false,
        allowMessageDelete: true,
        showTimestamps: true,
        enableMarkdown: true,
        enableCodeHighlight: true,
        persistHistory: true,
      },
    },
    previewComponents: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // WORKFLOW AGENT TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "workflow-visual",
    name: "Visual Workflow",
    description: "Workflow canvas with step visualization",
    forAgentTypes: ["workflow"],
    layout: "workflow-canvas",
    defaultConfig: {
      layout: "workflow-canvas",
      theme: "light",
      customColors: UI_THEMES.purple,
      blocks: [
        { block: "agent-avatar", enabled: true, position: "header" },
        { block: "workflow-diagram", enabled: true, position: "main" },
        { block: "task-list", enabled: true, position: "sidebar" },
        { block: "tool-result", enabled: true, position: "main" },
        { block: "error-banner", enabled: true, position: "main" },
      ],
      behavior: {
        autoScroll: false,
        showTypingIndicator: true,
        enableVoiceInput: false,
        enableFileUpload: false,
        showToolExecutions: true,
        allowMessageEdit: false,
        allowMessageDelete: true,
        showTimestamps: true,
        enableMarkdown: true,
        enableCodeHighlight: true,
        persistHistory: true,
      },
    },
    previewComponents: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MULTI-AGENT TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "multi-agent-split",
    name: "Multi-Agent Split",
    description: "Split view with agent outputs side by side",
    forAgentTypes: ["multi-agent"],
    layout: "split-panel",
    defaultConfig: {
      layout: "split-panel",
      theme: "light",
      customColors: UI_THEMES.default,
      blocks: [
        { block: "agent-avatar", enabled: true, position: "header" },
        { block: "chat-messages", enabled: true, position: "main" },
        { block: "streaming-indicator", enabled: true, position: "main" },
        { block: "tool-result", enabled: true, position: "sidebar" },
        { block: "chat-input", enabled: true, position: "footer" },
        { block: "error-banner", enabled: true, position: "main" },
      ],
      behavior: {
        autoScroll: true,
        showTypingIndicator: true,
        enableVoiceInput: false,
        enableFileUpload: false,
        showToolExecutions: true,
        allowMessageEdit: false,
        allowMessageDelete: true,
        showTimestamps: true,
        enableMarkdown: true,
        enableCodeHighlight: true,
        persistHistory: true,
      },
    },
    previewComponents: [],
  },
  {
    id: "multi-agent-wizard",
    name: "Guided Wizard",
    description: "Step-by-step guided interaction with multiple agents",
    forAgentTypes: ["multi-agent", "workflow"],
    layout: "wizard",
    defaultConfig: {
      layout: "wizard",
      theme: "light",
      customColors: UI_THEMES.corporate,
      blocks: [
        { block: "agent-avatar", enabled: true, position: "header" },
        { block: "chat-messages", enabled: true, position: "main" },
        { block: "quick-actions", enabled: true, position: "main" },
        { block: "chat-input", enabled: true, position: "footer" },
        { block: "error-banner", enabled: true, position: "main" },
      ],
      behavior: {
        autoScroll: true,
        showTypingIndicator: true,
        enableVoiceInput: false,
        enableFileUpload: false,
        showToolExecutions: false,
        allowMessageEdit: false,
        allowMessageDelete: false,
        showTimestamps: false,
        enableMarkdown: true,
        enableCodeHighlight: false,
        persistHistory: true,
        maxVisibleMessages: 10,
      },
    },
    previewComponents: [],
  },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get templates for a specific agent type
 */
export function getTemplatesForAgentType(agentType: AgentType): AgentUITemplate[] {
  return AGENT_UI_TEMPLATES.filter((t) => t.forAgentTypes.includes(agentType));
}

/**
 * Get template by ID
 */
export function getTemplateById(templateId: string): AgentUITemplate | undefined {
  return AGENT_UI_TEMPLATES.find((t) => t.id === templateId);
}

/**
 * Get recommended template for agent type
 */
export function getRecommendedTemplate(agentType: AgentType): AgentUITemplate {
  const templates = getTemplatesForAgentType(agentType);
  return templates[0] || AGENT_UI_TEMPLATES[0];
}

/**
 * Get available themes
 */
export function getAvailableThemes(): Array<{ id: string; name: string; colors: AgentUIColors }> {
  return [
    { id: "default", name: "Default Blue", colors: UI_THEMES.default },
    { id: "dark", name: "Dark Mode", colors: UI_THEMES.dark },
    { id: "purple", name: "Purple", colors: UI_THEMES.purple },
    { id: "green", name: "Green", colors: UI_THEMES.green },
    { id: "corporate", name: "Corporate", colors: UI_THEMES.corporate },
  ];
}

/**
 * Create custom config from template with overrides
 */
export function createConfigFromTemplate(
  templateId: string,
  overrides?: Partial<AgentUIConfig>,
): AgentUIConfig {
  const template = getTemplateById(templateId) || AGENT_UI_TEMPLATES[0];
  const baseConfig = template.defaultConfig;
  
  // Ensure complete colors object (using type assertion since UI_THEMES.default has all required fields)
  const baseColors: AgentUIColors = baseConfig.customColors || UI_THEMES.default as AgentUIColors;
  const mergedColors: AgentUIColors = {
    primary: overrides?.customColors?.primary ?? baseColors.primary,
    secondary: overrides?.customColors?.secondary ?? baseColors.secondary,
    background: overrides?.customColors?.background ?? baseColors.background,
    surface: overrides?.customColors?.surface ?? baseColors.surface,
    text: overrides?.customColors?.text ?? baseColors.text,
    textSecondary: overrides?.customColors?.textSecondary ?? baseColors.textSecondary,
    border: overrides?.customColors?.border ?? baseColors.border,
    success: overrides?.customColors?.success ?? baseColors.success,
    warning: overrides?.customColors?.warning ?? baseColors.warning,
    error: overrides?.customColors?.error ?? baseColors.error,
    userBubble: overrides?.customColors?.userBubble ?? baseColors.userBubble,
    assistantBubble: overrides?.customColors?.assistantBubble ?? baseColors.assistantBubble,
  };

  // Ensure complete behavior object
  const baseBehavior = baseConfig.behavior || {
    autoScroll: true,
    showTypingIndicator: true,
    enableVoiceInput: false,
    enableFileUpload: false,
    showToolExecutions: false,
    allowMessageEdit: false,
    allowMessageDelete: true,
    showTimestamps: true,
    enableMarkdown: true,
    enableCodeHighlight: true,
    persistHistory: true,
  };
  
  const mergedBehavior: AgentUIBehavior = {
    autoScroll: overrides?.behavior?.autoScroll ?? baseBehavior.autoScroll,
    showTypingIndicator: overrides?.behavior?.showTypingIndicator ?? baseBehavior.showTypingIndicator,
    enableVoiceInput: overrides?.behavior?.enableVoiceInput ?? baseBehavior.enableVoiceInput,
    enableFileUpload: overrides?.behavior?.enableFileUpload ?? baseBehavior.enableFileUpload,
    showToolExecutions: overrides?.behavior?.showToolExecutions ?? baseBehavior.showToolExecutions,
    allowMessageEdit: overrides?.behavior?.allowMessageEdit ?? baseBehavior.allowMessageEdit,
    allowMessageDelete: overrides?.behavior?.allowMessageDelete ?? baseBehavior.allowMessageDelete,
    showTimestamps: overrides?.behavior?.showTimestamps ?? baseBehavior.showTimestamps,
    enableMarkdown: overrides?.behavior?.enableMarkdown ?? baseBehavior.enableMarkdown,
    enableCodeHighlight: overrides?.behavior?.enableCodeHighlight ?? baseBehavior.enableCodeHighlight,
    persistHistory: overrides?.behavior?.persistHistory ?? baseBehavior.persistHistory,
    maxVisibleMessages: overrides?.behavior?.maxVisibleMessages ?? baseBehavior.maxVisibleMessages,
  };

  return {
    layout: overrides?.layout ?? baseConfig.layout,
    theme: overrides?.theme ?? baseConfig.theme,
    customColors: mergedColors,
    blocks: overrides?.blocks ?? baseConfig.blocks,
    branding: overrides?.branding ?? baseConfig.branding,
    behavior: mergedBehavior,
    responsive: overrides?.responsive ?? baseConfig.responsive,
  };
}
