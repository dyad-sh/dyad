import { z } from 'zod';

// Transport types
export const TransportType = z.enum(['stdio', 'sse', 'streamable-http']);
export type TransportType = z.infer<typeof TransportType>;

// STDIO Transport Configuration
export const StdioTransportConfig = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
});
export type StdioTransportConfig = z.infer<typeof StdioTransportConfig>;

// SSE Transport Configuration
export const SseTransportConfig = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});
export type SseTransportConfig = z.infer<typeof SseTransportConfig>;

// Streamable HTTP Transport Configuration
export const StreamableHttpTransportConfig = z.object({
  type: z.literal('streamable-http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});
export type StreamableHttpTransportConfig = z.infer<typeof StreamableHttpTransportConfig>;

// Union of all transport configs
export const TransportConfig = z.union([
  StdioTransportConfig,
  SseTransportConfig,
  StreamableHttpTransportConfig,
]);
export type TransportConfig = z.infer<typeof TransportConfig>;

// Individual MCP Server Configuration
export const McpServerConfig = z.object({
  transport: TransportConfig,
});
export type McpServerConfig = z.infer<typeof McpServerConfig>;

// Complete MCP Configuration
export const McpConfig = z.object({
  mcpServers: z.record(z.string(), McpServerConfig),
});
export type McpConfig = z.infer<typeof McpConfig>;

// MCP Settings (for UI state management)
export const McpSettings = z.object({
  mcpConfig: McpConfig,
  maxLLMSteps: z.number().min(1).max(50).default(10),
});
export type McpSettings = z.infer<typeof McpSettings>;

// Tool and Server Types
export type Tool = {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
};

export type ToolSet = Record<string, Tool>;

export type MCPServerTools = Record<string, {
  status: 'available' | 'unavailable' | 'checking';
  tools: Tool[];
  error?: string;
}>;

// Tool Call Annotation for frontend processing
export type ToolCallAnnotation = {
  type: 'toolCall';
  toolCallId: string;
  serverName: string;
  toolName: string;
  toolDescription: string;
};

// Tool execution constants
export const TOOL_EXECUTION_APPROVAL = {
  APPROVE: 'Yes, approved.',
  REJECT: 'No, rejected.',
} as const;

export const TOOL_NO_EXECUTE_FUNCTION = 'Error: No execute function found on tool';
export const TOOL_EXECUTION_DENIED = 'Error: User denied access to tool execution';
export const TOOL_EXECUTION_ERROR = 'Error: An error occured while calling tool';
