/**
 * Agent UI Generator
 * Generates complete agent UIs from configuration,
 * leveraging the existing visual app builder infrastructure.
 */

import type { AgentType } from "@/db/schema";
import type {
  ComponentType,
  AppComponent,
  ComponentStyles,
  AppPage,
  ComponentId,
} from "@/types/sovereign_stack_types";
import type {
  AgentUIConfig,
  AgentUILayout,
  AgentUIBlock,
  AgentUIBlockConfig,
  AgentUIColors,
  AgentUIBranding,
  AgentUIBehavior,
  GenerateAgentUIRequest,
  GenerateAgentUIResult,
  AgentUIPage,
} from "@/types/agent_ui_types";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_COLORS: AgentUIColors = {
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
};

const DEFAULT_BEHAVIOR: AgentUIBehavior = {
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
  maxVisibleMessages: 100,
};

// =============================================================================
// LAYOUT-TO-BLOCKS MAPPING
// =============================================================================

const LAYOUT_DEFAULT_BLOCKS: Record<AgentUILayout, AgentUIBlock[]> = {
  "chat-standard": [
    "agent-avatar",
    "chat-messages",
    "streaming-indicator",
    "chat-input",
    "error-banner",
  ],
  "chat-sidebar": [
    "agent-avatar",
    "chat-messages",
    "streaming-indicator",
    "chat-input",
    "context-sidebar",
    "knowledge-card",
    "quick-actions",
    "error-banner",
  ],
  dashboard: [
    "agent-avatar",
    "metrics-panel",
    "task-list",
    "task-card",
    "quick-actions",
    "error-banner",
  ],
  "workflow-canvas": [
    "workflow-diagram",
    "task-list",
    "tool-result",
    "error-banner",
  ],
  "split-panel": [
    "chat-input",
    "chat-messages",
    "tool-result",
    "error-banner",
  ],
  wizard: [
    "agent-avatar",
    "chat-messages",
    "quick-actions",
    "chat-input",
    "error-banner",
  ],
  embedded: [
    "chat-messages",
    "streaming-indicator",
    "chat-input",
  ],
  custom: [],
};

// =============================================================================
// AGENT TYPE TO LAYOUT MAPPING
// =============================================================================

const AGENT_TYPE_DEFAULT_LAYOUT: Record<AgentType, AgentUILayout> = {
  chatbot: "chat-sidebar",
  task: "dashboard",
  "multi-agent": "split-panel",
  workflow: "workflow-canvas",
  rag: "chat-sidebar",
};

// =============================================================================
// COMPONENT GENERATORS
// =============================================================================

let componentIdCounter = 0;

function generateId(): ComponentId {
  return `comp_${Date.now()}_${++componentIdCounter}` as ComponentId;
}

function createComponent(
  type: ComponentType,
  name: string,
  props: Record<string, unknown> = {},
  styles: ComponentStyles = {},
  children?: ComponentId[],
): AppComponent {
  return {
    id: generateId(),
    type,
    name,
    props,
    styles,
    children,
  };
}

// =============================================================================
// BLOCK GENERATORS
// =============================================================================

function generateChatInputBlock(
  colors: AgentUIColors,
  branding: AgentUIBranding | undefined,
  behavior: AgentUIBehavior,
): AppComponent[] {
  const components: AppComponent[] = [];

  // Container
  const container = createComponent(
    "container",
    "ChatInputContainer",
    {},
    {
      display: "flex",
      flexDirection: "row",
      gap: "8px",
      padding: "16px",
      borderTop: `1px solid ${colors.border}`,
      backgroundColor: colors.surface,
    },
  );

  // Text input
  const input = createComponent(
    "textarea",
    "ChatInput",
    {
      placeholder: branding?.placeholderText || "Type your message...",
      rows: 1,
    },
    {
      padding: "12px 16px",
      borderRadius: "8px",
      border: `1px solid ${colors.border}`,
      backgroundColor: colors.background,
      color: colors.text,
      minHeight: "44px",
      maxHeight: "120px",
      overflow: "auto",
    },
  );

  // Send button
  const sendButton = createComponent(
    "button",
    "SendButton",
    {
      label: "Send",
      variant: "primary",
    },
    {
      padding: "12px 20px",
      borderRadius: "8px",
      backgroundColor: colors.primary,
      color: "#ffffff",
      cursor: "pointer",
    },
  );
  sendButton.events = [
    { trigger: "click", action: { type: "custom", code: "sendMessage()" } },
  ];

  // Optional file upload
  if (behavior.enableFileUpload) {
    const fileButton = createComponent(
      "button",
      "FileUploadButton",
      { label: "📎", variant: "ghost" },
      {
        padding: "12px",
        borderRadius: "8px",
        backgroundColor: "transparent",
        cursor: "pointer",
      },
    );
    components.push(fileButton);
  }

  // Optional voice input
  if (behavior.enableVoiceInput) {
    const voiceButton = createComponent(
      "button",
      "VoiceInputButton",
      { label: "🎤", variant: "ghost" },
      {
        padding: "12px",
        borderRadius: "8px",
        backgroundColor: "transparent",
        cursor: "pointer",
      },
    );
    components.push(voiceButton);
  }

  components.push(container, input, sendButton);
  return components;
}

function generateChatMessagesBlock(
  colors: AgentUIColors,
  behavior: AgentUIBehavior,
): AppComponent[] {
  // Messages container with scroll
  const messagesContainer = createComponent(
    "container",
    "ChatMessagesContainer",
    {},
    {
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "16px",
      overflow: "auto",
      height: "100%",
      backgroundColor: colors.background,
    },
  );

  // User message template
  const userMessage = createComponent(
    "container",
    "UserMessageBubble",
    { role: "user" },
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "end",
      gap: "8px",
      padding: "12px 16px",
      borderRadius: "16px 16px 0 16px",
      backgroundColor: colors.userBubble,
      color: "#ffffff",
      maxWidth: "80%",
    },
  );

  // Assistant message template
  const assistantMessage = createComponent(
    "container",
    "AssistantMessageBubble",
    { role: "assistant" },
    {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      padding: "12px 16px",
      borderRadius: "16px 16px 16px 0",
      backgroundColor: colors.assistantBubble,
      color: colors.text,
      maxWidth: "80%",
    },
  );

  return [messagesContainer, userMessage, assistantMessage];
}

function generateAgentAvatarBlock(
  colors: AgentUIColors,
  branding: AgentUIBranding | undefined,
): AppComponent[] {
  // Header with agent info
  const header = createComponent(
    "container",
    "AgentHeader",
    {},
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: "12px",
      padding: "16px",
      borderBottom: `1px solid ${colors.border}`,
      backgroundColor: colors.surface,
    },
  );

  // Avatar
  const avatar = createComponent(
    "avatar",
    "AgentAvatar",
    {
      src: branding?.agentAvatar || "",
      name: branding?.agentName || "AI Agent",
      size: "md",
    },
    {
      borderRadius: "9999px",
    },
  );

  // Name and status
  const nameContainer = createComponent(
    "container",
    "AgentNameContainer",
    {},
    {
      display: "flex",
      flexDirection: "column",
    },
  );

  const name = createComponent(
    "text",
    "AgentName",
    {
      content: branding?.agentName || "AI Assistant",
      variant: "h4",
    },
    {
      fontWeight: "600",
      color: colors.text,
    },
  );

  const status = createComponent(
    "badge",
    "AgentStatus",
    { label: "Online", variant: "success" },
    {
      fontSize: "12px",
    },
  );

  return [header, avatar, nameContainer, name, status];
}

function generateStreamingIndicatorBlock(colors: AgentUIColors): AppComponent[] {
  const indicator = createComponent(
    "container",
    "StreamingIndicator",
    {},
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: "8px",
      padding: "8px 16px",
    },
  );

  const spinner = createComponent(
    "spinner",
    "ThinkingSpinner",
    { size: "sm" },
    {},
  );

  const text = createComponent(
    "text",
    "ThinkingText",
    { content: "Thinking...", variant: "caption" },
    { color: colors.textSecondary },
  );

  return [indicator, spinner, text];
}

function generateContextSidebarBlock(
  colors: AgentUIColors,
  knowledgeSources?: Array<{ name: string; type: string }>,
): AppComponent[] {
  const sidebar = createComponent(
    "container",
    "ContextSidebar",
    {},
    {
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "16px",
      backgroundColor: colors.surface,
      borderLeft: `1px solid ${colors.border}`,
      minWidth: "280px",
      maxWidth: "320px",
    },
  );

  const title = createComponent(
    "text",
    "SidebarTitle",
    { content: "Context", variant: "h4" },
    { fontWeight: "600", color: colors.text },
  );

  const components: AppComponent[] = [sidebar, title];

  // Add knowledge source cards
  if (knowledgeSources && knowledgeSources.length > 0) {
    for (const source of knowledgeSources.slice(0, 5)) {
      const card = createComponent(
        "card",
        `KnowledgeSource_${source.name}`,
        { title: source.name },
        {
          padding: "12px",
          backgroundColor: colors.background,
          borderRadius: "8px",
          border: `1px solid ${colors.border}`,
        },
      );

      const badge = createComponent(
        "badge",
        `KnowledgeType_${source.name}`,
        { label: source.type, variant: "default" },
        { fontSize: "11px" },
      );

      components.push(card, badge);
    }
  }

  return components;
}

function generateQuickActionsBlock(
  colors: AgentUIColors,
  tools?: Array<{ name: string; description?: string }>,
): AppComponent[] {
  const container = createComponent(
    "container",
    "QuickActionsContainer",
    {},
    {
      display: "flex",
      flexDirection: "row",
      gap: "8px",
      padding: "12px 16px",
      overflow: "auto",
    },
  );

  const components: AppComponent[] = [container];

  // Generate action buttons for tools
  if (tools && tools.length > 0) {
    for (const tool of tools.slice(0, 6)) {
      const button = createComponent(
        "button",
        `QuickAction_${tool.name}`,
        { label: tool.name, variant: "outline" },
        {
          padding: "8px 12px",
          borderRadius: "16px",
          fontSize: "13px",
          backgroundColor: "transparent",
          border: `1px solid ${colors.border}`,
          color: colors.text,
          cursor: "pointer",
        },
      );
      button.events = [
        {
          trigger: "click",
          action: { type: "runAgent", agentId: "", message: `Use ${tool.name}` },
        },
      ];
      components.push(button);
    }
  }

  return components;
}

function generateToolResultBlock(colors: AgentUIColors): AppComponent[] {
  const card = createComponent(
    "card",
    "ToolResultCard",
    { title: "Tool Execution" },
    {
      padding: "12px",
      backgroundColor: colors.surface,
      borderRadius: "8px",
      border: `1px solid ${colors.border}`,
    },
  );

  const toolName = createComponent(
    "text",
    "ToolName",
    { content: "Tool Name", variant: "body" },
    { fontWeight: "600", color: colors.text },
  );

  const status = createComponent(
    "badge",
    "ToolStatus",
    { label: "Completed", variant: "success" },
    { fontSize: "11px" },
  );

  const output = createComponent(
    "code",
    "ToolOutput",
    { content: "{}" },
    {
      padding: "8px",
      backgroundColor: colors.background,
      borderRadius: "4px",
      fontSize: "12px",
    },
  );

  return [card, toolName, status, output];
}

function generateErrorBannerBlock(colors: AgentUIColors): AppComponent[] {
  const banner = createComponent(
    "container",
    "ErrorBanner",
    {},
    {
      display: "none", // Hidden by default, shown on error
      flexDirection: "row",
      alignItems: "center",
      gap: "12px",
      padding: "12px 16px",
      backgroundColor: `${colors.error}10`,
      border: `1px solid ${colors.error}`,
      borderRadius: "8px",
      margin: "8px 16px",
    },
  );

  const icon = createComponent(
    "icon",
    "ErrorIcon",
    { name: "alert-circle", size: 20, color: colors.error },
    {},
  );

  const message = createComponent(
    "text",
    "ErrorMessage",
    { content: "An error occurred", variant: "body" },
    { color: colors.error },
  );

  const dismissButton = createComponent(
    "button",
    "DismissErrorButton",
    { label: "✕", variant: "ghost" },
    {
      padding: "4px 8px",
      backgroundColor: "transparent",
      color: colors.error,
      cursor: "pointer",
    },
  );

  return [banner, icon, message, dismissButton];
}

function generateTaskListBlock(colors: AgentUIColors): AppComponent[] {
  const container = createComponent(
    "container",
    "TaskListContainer",
    {},
    {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      padding: "16px",
    },
  );

  const title = createComponent(
    "text",
    "TaskListTitle",
    { content: "Tasks", variant: "h4" },
    { fontWeight: "600", color: colors.text },
  );

  const list = createComponent(
    "list",
    "TaskList",
    { items: [], variant: "none" },
    {},
  );

  return [container, title, list];
}

function generateMetricsPanelBlock(colors: AgentUIColors): AppComponent[] {
  const container = createComponent(
    "container",
    "MetricsPanel",
    {},
    {
      display: "grid",
      gap: "16px",
      padding: "16px",
    },
  );

  // Sample metric cards
  const metrics = [
    { label: "Tasks Completed", value: "0" },
    { label: "Success Rate", value: "0%" },
    { label: "Avg Response Time", value: "0ms" },
  ];

  const components: AppComponent[] = [container];

  for (const metric of metrics) {
    const card = createComponent(
      "card",
      `Metric_${metric.label.replace(/\s/g, "")}`,
      {},
      {
        padding: "16px",
        backgroundColor: colors.surface,
        borderRadius: "8px",
        border: `1px solid ${colors.border}`,
      },
    );

    const label = createComponent(
      "text",
      `MetricLabel_${metric.label}`,
      { content: metric.label, variant: "caption" },
      { color: colors.textSecondary },
    );

    const value = createComponent(
      "text",
      `MetricValue_${metric.label}`,
      { content: metric.value, variant: "h3" },
      { fontWeight: "700", color: colors.text },
    );

    components.push(card, label, value);
  }

  return components;
}

function generateWorkflowDiagramBlock(colors: AgentUIColors): AppComponent[] {
  const canvas = createComponent(
    "container",
    "WorkflowCanvas",
    {},
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "400px",
      backgroundColor: colors.surface,
      borderRadius: "8px",
      border: `1px solid ${colors.border}`,
      overflow: "hidden",
    },
  );

  const placeholder = createComponent(
    "text",
    "WorkflowPlaceholder",
    { content: "Workflow visualization will appear here", variant: "body" },
    {
      textAlign: "center",
      padding: "40px",
      color: colors.textSecondary,
    },
  );

  return [canvas, placeholder];
}

function generateKnowledgeCardBlock(colors: AgentUIColors): AppComponent[] {
  const card = createComponent(
    "card",
    "KnowledgeCard",
    { title: "Knowledge Base" },
    {
      padding: "12px",
      backgroundColor: colors.surface,
      borderRadius: "8px",
      border: `1px solid ${colors.border}`,
    },
  );

  const badge = createComponent(
    "badge",
    "KnowledgeStatus",
    { label: "Connected", variant: "success" },
    { fontSize: "11px" },
  );

  return [card, badge];
}

function generateTaskCardBlock(colors: AgentUIColors): AppComponent[] {
  const card = createComponent(
    "card",
    "TaskCard",
    { title: "Task" },
    {
      padding: "12px",
      backgroundColor: colors.background,
      borderRadius: "8px",
      border: `1px solid ${colors.border}`,
    },
  );

  const status = createComponent(
    "badge",
    "TaskStatus",
    { label: "Pending", variant: "default" },
    { fontSize: "11px" },
  );

  const progress = createComponent(
    "progress",
    "TaskProgress",
    { value: 0, max: 100 },
    { width: "100%", height: "4px" },
  );

  return [card, status, progress];
}

// =============================================================================
// BLOCK GENERATOR DISPATCHER
// =============================================================================

function generateBlockComponents(
  block: AgentUIBlock,
  colors: AgentUIColors,
  branding: AgentUIBranding | undefined,
  behavior: AgentUIBehavior,
  tools?: Array<{ name: string; description?: string }>,
  knowledgeSources?: Array<{ name: string; type: string }>,
): AppComponent[] {
  switch (block) {
    case "chat-input":
      return generateChatInputBlock(colors, branding, behavior);
    case "chat-messages":
      return generateChatMessagesBlock(colors, behavior);
    case "agent-avatar":
      return generateAgentAvatarBlock(colors, branding);
    case "streaming-indicator":
      return generateStreamingIndicatorBlock(colors);
    case "context-sidebar":
      return generateContextSidebarBlock(colors, knowledgeSources);
    case "quick-actions":
      return generateQuickActionsBlock(colors, tools);
    case "tool-result":
      return generateToolResultBlock(colors);
    case "error-banner":
      return generateErrorBannerBlock(colors);
    case "task-list":
      return generateTaskListBlock(colors);
    case "task-card":
      return generateTaskCardBlock(colors);
    case "metrics-panel":
      return generateMetricsPanelBlock(colors);
    case "workflow-diagram":
      return generateWorkflowDiagramBlock(colors);
    case "knowledge-card":
      return generateKnowledgeCardBlock(colors);
    default:
      return [];
  }
}

// =============================================================================
// LAYOUT GENERATORS
// =============================================================================

function generateChatStandardLayout(
  components: AppComponent[],
  colors: AgentUIColors,
): AppComponent {
  return createComponent(
    "container",
    "ChatStandardLayout",
    {},
    {
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      backgroundColor: colors.background,
    },
    components.map((c) => c.id),
  );
}

function generateChatSidebarLayout(
  components: AppComponent[],
  colors: AgentUIColors,
): AppComponent {
  return createComponent(
    "container",
    "ChatSidebarLayout",
    {},
    {
      display: "flex",
      flexDirection: "row",
      height: "100vh",
      backgroundColor: colors.background,
    },
    components.map((c) => c.id),
  );
}

function generateDashboardLayout(
  components: AppComponent[],
  colors: AgentUIColors,
): AppComponent {
  return createComponent(
    "container",
    "DashboardLayout",
    {},
    {
      display: "grid",
      gap: "16px",
      padding: "16px",
      height: "100vh",
      backgroundColor: colors.background,
    },
    components.map((c) => c.id),
  );
}

function generateSplitPanelLayout(
  components: AppComponent[],
  colors: AgentUIColors,
): AppComponent {
  return createComponent(
    "container",
    "SplitPanelLayout",
    {},
    {
      display: "flex",
      flexDirection: "row",
      height: "100vh",
      backgroundColor: colors.background,
    },
    components.map((c) => c.id),
  );
}

// =============================================================================
// MAIN GENERATOR
// =============================================================================

export function generateAgentUI(
  request: GenerateAgentUIRequest,
): GenerateAgentUIResult {
  // Determine layout
  const layout =
    request.config.layout || AGENT_TYPE_DEFAULT_LAYOUT[request.agentType];

  // Determine blocks
  const defaultBlocks = LAYOUT_DEFAULT_BLOCKS[layout] || [];
  const blockConfigs: AgentUIBlockConfig[] =
    request.config.blocks ||
    defaultBlocks.map((block) => ({
      block,
      enabled: true,
    }));

  // Merge colors
  const colors: AgentUIColors = {
    ...DEFAULT_COLORS,
    ...request.config.customColors,
  };

  // Merge behavior
  const behavior: AgentUIBehavior = {
    ...DEFAULT_BEHAVIOR,
    ...request.config.behavior,
  };

  // Branding
  const branding: AgentUIBranding = {
    agentName: request.agentName,
    ...request.config.branding,
  };

  // Generate components for each enabled block
  const allComponents: AppComponent[] = [];

  for (const blockConfig of blockConfigs) {
    if (!blockConfig.enabled) continue;

    const blockComponents = generateBlockComponents(
      blockConfig.block,
      colors,
      branding,
      behavior,
      request.tools,
      request.knowledgeSources,
    );

    // Apply custom styles if provided
    if (blockConfig.customStyles) {
      for (const comp of blockComponents) {
        comp.styles = { ...comp.styles, ...blockConfig.customStyles };
      }
    }

    allComponents.push(...blockComponents);
  }

  // Create layout wrapper
  let layoutComponent: AppComponent;
  switch (layout) {
    case "chat-sidebar":
      layoutComponent = generateChatSidebarLayout(allComponents, colors);
      break;
    case "dashboard":
      layoutComponent = generateDashboardLayout(allComponents, colors);
      break;
    case "split-panel":
      layoutComponent = generateSplitPanelLayout(allComponents, colors);
      break;
    default:
      layoutComponent = generateChatStandardLayout(allComponents, colors);
  }

  // Create page
  const page: AgentUIPage = {
    id: `page_${request.agentId}_${Date.now()}`,
    name: `${request.agentName} UI`,
    path: `/agent/${request.agentId}`,
    layout,
    blocks: blockConfigs.filter((b) => b.enabled).map((b) => b.block),
    components: [layoutComponent, ...allComponents],
  };

  return {
    appId: request.existingAppId || 0,
    pages: [page],
    components: [layoutComponent, ...allComponents],
    exportFormats: ["react", "vue", "html"],
  };
}

/**
 * Get recommended UI config for agent type
 */
export function getRecommendedUIConfig(
  agentType: AgentType,
  hasTools: boolean,
  hasKnowledge: boolean,
): Partial<AgentUIConfig> {
  const layout = AGENT_TYPE_DEFAULT_LAYOUT[agentType];
  const defaultBlocks = LAYOUT_DEFAULT_BLOCKS[layout];

  const blocks: AgentUIBlockConfig[] = defaultBlocks.map((block) => ({
    block,
    enabled:
      block === "quick-actions"
        ? hasTools
        : block === "knowledge-card" || block === "context-sidebar"
          ? hasKnowledge
          : true,
  }));

  return {
    layout,
    theme: "system",
    blocks,
    behavior: {
      ...DEFAULT_BEHAVIOR,
      enableFileUpload: hasKnowledge,
      showToolExecutions: hasTools,
    },
  };
}

/**
 * Export UI to different frameworks
 */
export function exportAgentUI(
  result: GenerateAgentUIResult,
  format: "react" | "vue" | "html",
): string {
  // This would generate actual code for the target framework
  // For now, return a placeholder
  const page = result.pages[0];
  
  switch (format) {
    case "react":
      return generateReactCode(page);
    case "vue":
      return generateVueCode(page);
    case "html":
      return generateHTMLCode(page);
    default:
      return "";
  }
}

function generateReactCode(page: AgentUIPage): string {
  return `// Generated Agent UI - React
import React, { useState } from 'react';

export function ${page.name.replace(/\s/g, "")}Page() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;
    setIsLoading(true);
    // Add message handling logic
    setInput('');
    setIsLoading(false);
  };

  return (
    <div className="agent-ui ${page.layout}">
      {/* Generated components */}
      ${page.components.map((c) => `<div className="${c.name}">{/* ${c.type} */}</div>`).join("\n      ")}
    </div>
  );
}
`;
}

function generateVueCode(page: AgentUIPage): string {
  return `<!-- Generated Agent UI - Vue -->
<template>
  <div class="agent-ui ${page.layout}">
    ${page.components.map((c) => `<div class="${c.name}"><!-- ${c.type} --></div>`).join("\n    ")}
  </div>
</template>

<script setup>
import { ref } from 'vue';

const messages = ref([]);
const input = ref('');
const isLoading = ref(false);

const sendMessage = async () => {
  if (!input.value.trim()) return;
  isLoading.value = true;
  // Add message handling logic
  input.value = '';
  isLoading.value = false;
};
</script>
`;
}

function generateHTMLCode(page: AgentUIPage): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>${page.name}</title>
  <style>
    .agent-ui { display: flex; flex-direction: column; height: 100vh; }
    /* Add generated styles */
  </style>
</head>
<body>
  <div class="agent-ui ${page.layout}">
    ${page.components.map((c) => `<div class="${c.name}"><!-- ${c.type} --></div>`).join("\n    ")}
  </div>
  <script>
    // Add agent interaction logic
  </script>
</body>
</html>
`;
}
