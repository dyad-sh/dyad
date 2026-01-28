/**
 * Session Upload Schema
 *
 * Comprehensive Zod schema for uploading chat session data to external services.
 * This schema captures all the information needed to debug and analyze chat sessions,
 * including:
 * - Full message history with AI SDK message details
 * - Tool calls and their results (each message can have many tool calls)
 * - Timing information for durations and performance analysis
 * - Error tracking with stack traces and correlation
 * - Token usage and model information
 *
 * @example Basic session upload payload
 * ```typescript
 * const payload: SessionUploadPayload = {
 *   schemaVersion: "1.0.0",
 *   sessionId: "abc123",
 *   uploadedAt: "2024-01-15T10:30:00.000Z",
 *   app: {
 *     id: 1,
 *     name: "my-app",
 *     path: "/apps/my-app",
 *   },
 *   chat: {
 *     id: 42,
 *     title: "Add user authentication",
 *     createdAt: "2024-01-15T09:00:00.000Z",
 *     initialCommitHash: "abc123",
 *   },
 *   messages: [
 *     {
 *       id: 1,
 *       role: "user",
 *       content: "Add login form",
 *       createdAt: "2024-01-15T09:00:00.000Z",
 *     },
 *     {
 *       id: 2,
 *       role: "assistant",
 *       content: "I'll create a login form...",
 *       createdAt: "2024-01-15T09:00:05.000Z",
 *       model: "claude-sonnet-4-20250514",
 *       aiCalls: [...],
 *       toolCalls: [...],
 *       timing: {
 *         startedAt: "2024-01-15T09:00:01.000Z",
 *         completedAt: "2024-01-15T09:00:05.000Z",
 *         durationMs: 4000,
 *         firstTokenAt: "2024-01-15T09:00:01.500Z",
 *         timeToFirstTokenMs: 500,
 *       },
 *     },
 *   ],
 *   summary: {
 *     totalMessages: 2,
 *     totalToolCalls: 5,
 *     totalAiCalls: 3,
 *     totalDurationMs: 4000,
 *     totalInputTokens: 1500,
 *     totalOutputTokens: 500,
 *     errorsCount: 0,
 *   },
 * };
 * ```
 */

import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Schema Version
// =============================================================================

/**
 * Current schema version for backwards compatibility.
 * Increment this when making breaking changes to the schema.
 */
export const SESSION_UPLOAD_SCHEMA_VERSION = "1.0.0" as const;

// =============================================================================
// Timing Schemas
// =============================================================================

/**
 * Timing information for tracking durations.
 * All timestamps are ISO 8601 strings for consistent serialization.
 *
 * @example
 * ```typescript
 * const timing: Timing = {
 *   startedAt: "2024-01-15T10:30:00.000Z",
 *   completedAt: "2024-01-15T10:30:05.000Z",
 *   durationMs: 5000,
 * };
 * ```
 */
export const TimingSchema = z.object({
  /** When the operation started (ISO 8601) */
  startedAt: z
    .string()
    .datetime()
    .describe("When the operation started (ISO 8601)"),

  /** When the operation completed (ISO 8601). Null if still in progress or failed. */
  completedAt: z
    .string()
    .datetime()
    .nullable()
    .describe("When the operation completed (ISO 8601)"),

  /** Total duration in milliseconds. Null if not completed. */
  durationMs: z.number().nullable().describe("Total duration in milliseconds"),
});

export type Timing = z.infer<typeof TimingSchema>;

/**
 * Extended timing for AI streaming responses.
 * Includes time-to-first-token metrics for latency analysis.
 *
 * @example
 * ```typescript
 * const streamTiming: StreamTiming = {
 *   startedAt: "2024-01-15T10:30:00.000Z",
 *   completedAt: "2024-01-15T10:30:05.000Z",
 *   durationMs: 5000,
 *   firstTokenAt: "2024-01-15T10:30:00.500Z",
 *   timeToFirstTokenMs: 500,
 * };
 * ```
 */
export const StreamTimingSchema = TimingSchema.extend({
  /** When the first token was received (ISO 8601). Null if no tokens received. */
  firstTokenAt: z
    .string()
    .datetime()
    .nullable()
    .describe("When the first token was received"),

  /** Time to first token in milliseconds. Key latency metric. */
  timeToFirstTokenMs: z
    .number()
    .nullable()
    .describe("Time to first token in milliseconds"),
});

export type StreamTiming = z.infer<typeof StreamTimingSchema>;

// =============================================================================
// Error Schemas
// =============================================================================

/**
 * Detailed error information for debugging.
 *
 * @example
 * ```typescript
 * const error: ErrorInfo = {
 *   code: "TOOL_EXECUTION_FAILED",
 *   message: "Failed to write file: Permission denied",
 *   stack: "Error: Failed to write file...\n    at writeFile (/app/tools/write_file.ts:42:11)",
 *   timestamp: "2024-01-15T10:30:02.000Z",
 *   context: {
 *     toolName: "write_file",
 *     filePath: "/etc/passwd",
 *   },
 * };
 * ```
 */
export const ErrorInfoSchema = z.object({
  /** Error code for categorization (e.g., "TOOL_EXECUTION_FAILED", "AI_STREAM_ERROR") */
  code: z.string().describe("Error code for categorization"),

  /** Human-readable error message */
  message: z.string().describe("Human-readable error message"),

  /** Full stack trace if available */
  stack: z
    .string()
    .nullable()
    .optional()
    .describe("Full stack trace if available"),

  /** When the error occurred (ISO 8601) */
  timestamp: z.string().datetime().describe("When the error occurred"),

  /** Additional context about the error (tool name, file path, etc.) */
  context: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Additional context about the error"),
});

export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

// =============================================================================
// Token Usage Schemas
// =============================================================================

/**
 * Token usage information for a single AI call.
 *
 * @example
 * ```typescript
 * const usage: TokenUsage = {
 *   inputTokens: 1500,
 *   outputTokens: 500,
 *   totalTokens: 2000,
 *   cachedInputTokens: 1000,
 *   cacheHitRatio: 0.67,
 * };
 * ```
 */
export const TokenUsageSchema = z.object({
  /** Number of input tokens sent to the model */
  inputTokens: z.number().describe("Number of input tokens sent to the model"),

  /** Number of output tokens generated by the model */
  outputTokens: z
    .number()
    .describe("Number of output tokens generated by the model"),

  /** Total tokens (input + output) */
  totalTokens: z.number().describe("Total tokens (input + output)"),

  /** Number of input tokens served from cache (for prompt caching) */
  cachedInputTokens: z
    .number()
    .nullable()
    .optional()
    .describe("Number of cached input tokens"),

  /** Cache hit ratio (cachedInputTokens / inputTokens). Between 0 and 1. */
  cacheHitRatio: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe("Cache hit ratio (0-1)"),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// =============================================================================
// Tool Call Schemas
// =============================================================================

/**
 * Tool call status enum.
 */
export const ToolCallStatusSchema = z.enum([
  "pending", // Tool call is waiting for execution
  "running", // Tool call is currently executing
  "success", // Tool call completed successfully
  "failed", // Tool call failed with an error
  "cancelled", // Tool call was cancelled (e.g., user abort)
  "denied", // Tool call was denied by user consent
]);

export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

/**
 * Individual tool call with full execution details.
 * Each AI call can invoke multiple tools, and each tool call is tracked separately.
 *
 * @example
 * ```typescript
 * const toolCall: ToolCallInfo = {
 *   id: "call_abc123",
 *   toolName: "write_file",
 *   status: "success",
 *   input: {
 *     file_path: "src/components/Login.tsx",
 *     content: "import React from 'react'...",
 *   },
 *   output: "File written successfully",
 *   timing: {
 *     startedAt: "2024-01-15T10:30:01.000Z",
 *     completedAt: "2024-01-15T10:30:02.000Z",
 *     durationMs: 1000,
 *   },
 *   error: null,
 *   consentRequired: true,
 *   consentDecision: "accept-once",
 * };
 * ```
 */
export const ToolCallInfoSchema = z.object({
  /** Unique identifier for this tool call (from AI SDK) */
  id: z.string().describe("Unique identifier for this tool call"),

  /** Name of the tool (e.g., "write_file", "read_file", "grep") */
  toolName: z.string().describe("Name of the tool"),

  /** Current status of the tool call */
  status: ToolCallStatusSchema.describe("Current status of the tool call"),

  /** Input arguments passed to the tool (JSON-serializable) */
  input: z.unknown().describe("Input arguments passed to the tool"),

  /** Output returned by the tool. Null if not completed or failed. */
  output: z.unknown().nullable().describe("Output returned by the tool"),

  /** Timing information for the tool execution */
  timing: TimingSchema.describe("Timing information for the tool execution"),

  /** Error information if the tool call failed */
  error: ErrorInfoSchema.nullable()
    .optional()
    .describe("Error information if the tool call failed"),

  /** Whether user consent was required for this tool */
  consentRequired: z.boolean().describe("Whether user consent was required"),

  /** User's consent decision if consent was required */
  consentDecision: z
    .enum(["accept-once", "accept-always", "decline"])
    .nullable()
    .optional()
    .describe("User's consent decision"),

  /** Index of the AI call (step) this tool belongs to */
  aiCallIndex: z.number().describe("Index of the AI call this tool belongs to"),

  /** Whether this is an MCP (Model Context Protocol) tool */
  isMcpTool: z.boolean().optional().describe("Whether this is an MCP tool"),

  /** MCP server name if this is an MCP tool */
  mcpServerName: z
    .string()
    .nullable()
    .optional()
    .describe("MCP server name if applicable"),
});

export type ToolCallInfo = z.infer<typeof ToolCallInfoSchema>;

// =============================================================================
// AI Call Schemas
// =============================================================================

/**
 * Reason why an AI call finished.
 */
export const AiCallFinishReasonSchema = z.enum([
  "stop", // Model finished naturally
  "tool-calls", // Model requested tool calls
  "length", // Hit max tokens limit
  "content-filter", // Content was filtered
  "error", // An error occurred
  "cancelled", // User cancelled the stream
  "unknown", // Unknown reason
]);

export type AiCallFinishReason = z.infer<typeof AiCallFinishReasonSchema>;

/**
 * Individual AI call (step) within a message.
 * A single assistant message can involve multiple AI calls when using tools
 * (the model calls tools, receives results, then continues).
 *
 * @example
 * ```typescript
 * const aiCall: AiCallInfo = {
 *   index: 0,
 *   model: "claude-sonnet-4-20250514",
 *   finishReason: "tool-calls",
 *   timing: {
 *     startedAt: "2024-01-15T10:30:00.000Z",
 *     completedAt: "2024-01-15T10:30:02.000Z",
 *     durationMs: 2000,
 *     firstTokenAt: "2024-01-15T10:30:00.300Z",
 *     timeToFirstTokenMs: 300,
 *   },
 *   tokenUsage: {
 *     inputTokens: 1500,
 *     outputTokens: 200,
 *     totalTokens: 1700,
 *   },
 *   toolCallIds: ["call_abc123", "call_def456"],
 *   textDeltaCount: 15,
 *   error: null,
 * };
 * ```
 */
export const AiCallInfoSchema = z.object({
  /** Zero-based index of this AI call within the message (step number) */
  index: z
    .number()
    .describe("Zero-based index of this AI call within the message"),

  /** Model used for this specific call (can differ between calls if model switching) */
  model: z.string().describe("Model used for this call"),

  /** Why the AI call finished */
  finishReason: AiCallFinishReasonSchema.describe("Why the AI call finished"),

  /** Timing information including time-to-first-token */
  timing: StreamTimingSchema.describe("Timing information including TTFT"),

  /** Token usage for this call */
  tokenUsage: TokenUsageSchema.nullable()
    .optional()
    .describe("Token usage for this call"),

  /** IDs of tool calls made during this AI call */
  toolCallIds: z
    .array(z.string())
    .describe("IDs of tool calls made during this AI call"),

  /** Number of text deltas received (useful for debugging streaming issues) */
  textDeltaCount: z.number().describe("Number of text deltas received"),

  /** Number of reasoning (thinking) deltas received */
  reasoningDeltaCount: z
    .number()
    .optional()
    .describe("Number of reasoning deltas received"),

  /** Error information if this call failed */
  error: ErrorInfoSchema.nullable()
    .optional()
    .describe("Error information if this call failed"),

  /** Provider-specific request ID for debugging with the AI provider */
  providerRequestId: z
    .string()
    .nullable()
    .optional()
    .describe("Provider-specific request ID"),
});

export type AiCallInfo = z.infer<typeof AiCallInfoSchema>;

// =============================================================================
// Message Schemas
// =============================================================================

/**
 * Attachment information for user messages.
 *
 * @example
 * ```typescript
 * const attachment: AttachmentInfo = {
 *   name: "screenshot.png",
 *   type: "image/png",
 *   attachmentType: "chat-context",
 *   sizeBytes: 102400,
 * };
 * ```
 */
export const AttachmentInfoSchema = z.object({
  /** Original filename */
  name: z.string().describe("Original filename"),

  /** MIME type of the attachment */
  type: z.string().describe("MIME type of the attachment"),

  /** How the attachment is used: uploaded to codebase or just for chat context */
  attachmentType: z
    .enum(["upload-to-codebase", "chat-context"])
    .describe("How the attachment is used"),

  /** Size in bytes (for monitoring large uploads) */
  sizeBytes: z.number().optional().describe("Size in bytes"),
});

export type AttachmentInfo = z.infer<typeof AttachmentInfoSchema>;

/**
 * Component selection info for user messages with selected code.
 *
 * @example
 * ```typescript
 * const component: ComponentSelectionInfo = {
 *   id: "comp_abc123",
 *   name: "LoginForm",
 *   relativePath: "src/components/LoginForm.tsx",
 *   lineNumber: 15,
 *   columnNumber: 3,
 * };
 * ```
 */
export const ComponentSelectionInfoSchema = z.object({
  /** Component identifier */
  id: z.string().describe("Component identifier"),

  /** Component name */
  name: z.string().describe("Component name"),

  /** File path relative to app root */
  relativePath: z.string().describe("File path relative to app root"),

  /** Line number where the component starts */
  lineNumber: z.number().describe("Line number where the component starts"),

  /** Column number where the component starts */
  columnNumber: z.number().describe("Column number where the component starts"),
});

export type ComponentSelectionInfo = z.infer<
  typeof ComponentSelectionInfoSchema
>;

/**
 * User message with input details.
 *
 * @example
 * ```typescript
 * const userMessage: UserMessageInfo = {
 *   id: 1,
 *   role: "user",
 *   content: "Add a login form with email and password fields",
 *   createdAt: "2024-01-15T10:30:00.000Z",
 *   attachments: [],
 *   selectedComponents: [],
 * };
 * ```
 */
export const UserMessageInfoSchema = z.object({
  /** Message ID (database primary key) */
  id: z.number().describe("Message ID"),

  /** Role is always "user" for user messages */
  role: z.literal("user").describe("Message role"),

  /** The user's prompt text */
  content: z.string().describe("The user's prompt text"),

  /** When the message was created (ISO 8601) */
  createdAt: z.string().datetime().describe("When the message was created"),

  /** Attachments included with the message */
  attachments: z
    .array(AttachmentInfoSchema)
    .optional()
    .describe("Attachments included with the message"),

  /** Components selected by the user in the UI */
  selectedComponents: z
    .array(ComponentSelectionInfoSchema)
    .optional()
    .describe("Components selected by the user"),
});

export type UserMessageInfo = z.infer<typeof UserMessageInfoSchema>;

/**
 * Assistant message with full AI call and tool call details.
 * This is the main message type for debugging AI behavior.
 *
 * @example
 * ```typescript
 * const assistantMessage: AssistantMessageInfo = {
 *   id: 2,
 *   role: "assistant",
 *   content: "I'll create a login form for you...",
 *   createdAt: "2024-01-15T10:30:05.000Z",
 *   model: "claude-sonnet-4-20250514",
 *   requestId: "req_abc123",
 *   approvalState: "approved",
 *   sourceCommitHash: "abc123",
 *   commitHash: "def456",
 *   timing: {
 *     startedAt: "2024-01-15T10:30:00.000Z",
 *     completedAt: "2024-01-15T10:30:05.000Z",
 *     durationMs: 5000,
 *     firstTokenAt: "2024-01-15T10:30:00.500Z",
 *     timeToFirstTokenMs: 500,
 *   },
 *   tokenUsage: {
 *     inputTokens: 2000,
 *     outputTokens: 800,
 *     totalTokens: 2800,
 *   },
 *   aiCalls: [...],
 *   toolCalls: [...],
 *   errors: [],
 * };
 * ```
 */
export const AssistantMessageInfoSchema = z.object({
  /** Message ID (database primary key) */
  id: z.number().describe("Message ID"),

  /** Role is always "assistant" for assistant messages */
  role: z.literal("assistant").describe("Message role"),

  /** The final response content (may include XML tool call representations) */
  content: z.string().describe("The final response content"),

  /** When the message was created (ISO 8601) */
  createdAt: z.string().datetime().describe("When the message was created"),

  /** Model used for this message (may be overridden per-call) */
  model: z
    .string()
    .nullable()
    .optional()
    .describe("Model used for this message"),

  /** Dyad request ID for correlation with backend logs */
  requestId: z
    .string()
    .nullable()
    .optional()
    .describe("Dyad request ID for correlation"),

  /** Approval state: approved, rejected, or null (pending) */
  approvalState: z
    .enum(["approved", "rejected"])
    .nullable()
    .optional()
    .describe("Approval state of changes"),

  /** Git commit hash of codebase when message was created */
  sourceCommitHash: z
    .string()
    .nullable()
    .optional()
    .describe("Commit hash when message was created"),

  /** Git commit hash created by this message's changes */
  commitHash: z
    .string()
    .nullable()
    .optional()
    .describe("Commit hash created by this message"),

  /** Overall timing for the entire message generation */
  timing: StreamTimingSchema.describe("Overall timing for message generation"),

  /** Aggregated token usage across all AI calls */
  tokenUsage: TokenUsageSchema.nullable()
    .optional()
    .describe("Aggregated token usage"),

  /**
   * Individual AI calls (steps) for this message.
   * In local-agent mode with tools, there can be many AI calls per message
   * as the model calls tools and continues reasoning.
   */
  aiCalls: z
    .array(AiCallInfoSchema)
    .describe("Individual AI calls (steps) for this message"),

  /**
   * All tool calls made during this message.
   * Use toolCall.aiCallIndex to correlate with specific AI calls.
   */
  toolCalls: z
    .array(ToolCallInfoSchema)
    .describe("All tool calls made during this message"),

  /** Errors that occurred during message generation */
  errors: z
    .array(ErrorInfoSchema)
    .optional()
    .describe("Errors during message generation"),

  /** Whether the message was cancelled by the user */
  wasCancelled: z
    .boolean()
    .optional()
    .describe("Whether the message was cancelled"),

  /** Max step count reached (hit stepCountIs limit) */
  maxStepsReached: z
    .boolean()
    .optional()
    .describe("Whether max steps limit was reached"),
});

export type AssistantMessageInfo = z.infer<typeof AssistantMessageInfoSchema>;

/**
 * Union of user and assistant message types.
 */
export const MessageInfoSchema = z.discriminatedUnion("role", [
  UserMessageInfoSchema,
  AssistantMessageInfoSchema,
]);

export type MessageInfo = z.infer<typeof MessageInfoSchema>;

// =============================================================================
// App and Chat Schemas
// =============================================================================

/**
 * App information for context.
 *
 * @example
 * ```typescript
 * const app: AppInfo = {
 *   id: 1,
 *   name: "my-saas-app",
 *   path: "/Users/dev/projects/my-saas-app",
 *   supabaseProjectId: "abc123",
 *   themeId: "default",
 * };
 * ```
 */
export const AppInfoSchema = z.object({
  /** App ID (database primary key) */
  id: z.number().describe("App ID"),

  /** Display name of the app */
  name: z.string().describe("Display name of the app"),

  /** Relative path to the app (within Dyad's apps directory) */
  path: z.string().describe("Relative path to the app"),

  /** Supabase project ID if connected */
  supabaseProjectId: z
    .string()
    .nullable()
    .optional()
    .describe("Supabase project ID"),

  /** Active theme ID */
  themeId: z.string().nullable().optional().describe("Active theme ID"),
});

export type AppInfo = z.infer<typeof AppInfoSchema>;

/**
 * Chat information for context.
 *
 * @example
 * ```typescript
 * const chat: ChatInfo = {
 *   id: 42,
 *   title: "Add user authentication",
 *   createdAt: "2024-01-15T09:00:00.000Z",
 *   initialCommitHash: "abc123",
 * };
 * ```
 */
export const ChatInfoSchema = z.object({
  /** Chat ID (database primary key) */
  id: z.number().describe("Chat ID"),

  /** Chat title (may be auto-generated or user-set) */
  title: z.string().nullable().describe("Chat title"),

  /** When the chat was created (ISO 8601) */
  createdAt: z.string().datetime().describe("When the chat was created"),

  /** Git commit hash at chat creation (baseline for changes) */
  initialCommitHash: z
    .string()
    .nullable()
    .optional()
    .describe("Initial commit hash"),
});

export type ChatInfo = z.infer<typeof ChatInfoSchema>;

// =============================================================================
// Settings Snapshot Schema
// =============================================================================

/**
 * Relevant settings captured at upload time for context.
 * Excludes sensitive data like API keys.
 *
 * @example
 * ```typescript
 * const settings: SettingsSnapshot = {
 *   chatMode: "local-agent",
 *   selectedModel: "claude-sonnet-4-20250514",
 *   enableDyadPro: true,
 *   proLazyEditsMode: "v2",
 *   smartContextMode: "balanced",
 * };
 * ```
 */
export const SettingsSnapshotSchema = z.object({
  /** Chat mode used for this session */
  chatMode: z
    .enum(["build", "ask", "agent", "local-agent"])
    .describe("Chat mode used"),

  /** Selected model name */
  selectedModel: z.string().describe("Selected model name"),

  /** Whether Dyad Pro was enabled */
  enableDyadPro: z
    .boolean()
    .optional()
    .describe("Whether Dyad Pro was enabled"),

  /** Lazy edits mode setting */
  proLazyEditsMode: z
    .enum(["off", "v1", "v2"])
    .nullable()
    .optional()
    .describe("Lazy edits mode"),

  /** Smart context mode setting */
  smartContextMode: z
    .enum(["balanced", "conservative", "deep"])
    .nullable()
    .optional()
    .describe("Smart context mode"),

  /** Whether auto-fix problems was enabled */
  enableAutoFixProblems: z
    .boolean()
    .optional()
    .describe("Whether auto-fix was enabled"),

  /** Max chat turns in context setting */
  maxChatTurnsInContext: z
    .number()
    .nullable()
    .optional()
    .describe("Max chat turns in context"),
});

export type SettingsSnapshot = z.infer<typeof SettingsSnapshotSchema>;

// =============================================================================
// Session Summary Schema
// =============================================================================

/**
 * Summary statistics for the session.
 *
 * @example
 * ```typescript
 * const summary: SessionSummary = {
 *   totalMessages: 10,
 *   userMessageCount: 5,
 *   assistantMessageCount: 5,
 *   totalToolCalls: 25,
 *   successfulToolCalls: 23,
 *   failedToolCalls: 2,
 *   totalAiCalls: 15,
 *   totalDurationMs: 45000,
 *   totalInputTokens: 15000,
 *   totalOutputTokens: 5000,
 *   totalTokens: 20000,
 *   errorsCount: 2,
 *   cancelledCount: 0,
 * };
 * ```
 */
export const SessionSummarySchema = z.object({
  /** Total number of messages in the session */
  totalMessages: z.number().describe("Total number of messages"),

  /** Number of user messages */
  userMessageCount: z.number().describe("Number of user messages"),

  /** Number of assistant messages */
  assistantMessageCount: z.number().describe("Number of assistant messages"),

  /** Total number of tool calls across all messages */
  totalToolCalls: z.number().describe("Total number of tool calls"),

  /** Number of successful tool calls */
  successfulToolCalls: z.number().describe("Number of successful tool calls"),

  /** Number of failed tool calls */
  failedToolCalls: z.number().describe("Number of failed tool calls"),

  /** Total number of AI calls (steps) across all messages */
  totalAiCalls: z.number().describe("Total number of AI calls"),

  /** Total duration of all assistant messages in milliseconds */
  totalDurationMs: z.number().describe("Total duration in milliseconds"),

  /** Total input tokens across all messages */
  totalInputTokens: z.number().describe("Total input tokens"),

  /** Total output tokens across all messages */
  totalOutputTokens: z.number().describe("Total output tokens"),

  /** Total tokens (input + output) */
  totalTokens: z.number().describe("Total tokens"),

  /** Number of errors that occurred */
  errorsCount: z.number().describe("Number of errors"),

  /** Number of messages that were cancelled */
  cancelledCount: z.number().describe("Number of cancelled messages"),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

// =============================================================================
// Client Information Schema
// =============================================================================

/**
 * Client environment information for debugging.
 *
 * @example
 * ```typescript
 * const client: ClientInfo = {
 *   dyadVersion: "1.2.3",
 *   platform: "darwin",
 *   architecture: "arm64",
 *   nodeVersion: "20.10.0",
 *   electronVersion: "28.0.0",
 * };
 * ```
 */
export const ClientInfoSchema = z.object({
  /** Dyad application version */
  dyadVersion: z.string().describe("Dyad application version"),

  /** Operating system platform */
  platform: z.string().describe("Operating system platform"),

  /** CPU architecture */
  architecture: z.string().describe("CPU architecture"),

  /** Node.js version */
  nodeVersion: z.string().nullable().optional().describe("Node.js version"),

  /** Electron version */
  electronVersion: z
    .string()
    .nullable()
    .optional()
    .describe("Electron version"),
});

export type ClientInfo = z.infer<typeof ClientInfoSchema>;

// =============================================================================
// Main Session Upload Payload Schema
// =============================================================================

/**
 * Complete session upload payload.
 * This is the main schema for uploading chat session data.
 *
 * @example Full payload
 * ```typescript
 * const payload: SessionUploadPayload = {
 *   schemaVersion: "1.0.0",
 *   sessionId: "session_abc123",
 *   uploadedAt: "2024-01-15T12:00:00.000Z",
 *   client: {
 *     dyadVersion: "1.2.3",
 *     platform: "darwin",
 *     architecture: "arm64",
 *   },
 *   settings: {
 *     chatMode: "local-agent",
 *     selectedModel: "claude-sonnet-4-20250514",
 *     enableDyadPro: true,
 *   },
 *   app: {
 *     id: 1,
 *     name: "my-app",
 *     path: "/apps/my-app",
 *   },
 *   chat: {
 *     id: 42,
 *     title: "Add authentication",
 *     createdAt: "2024-01-15T09:00:00.000Z",
 *   },
 *   messages: [
 *     {
 *       id: 1,
 *       role: "user",
 *       content: "Add login form",
 *       createdAt: "2024-01-15T09:00:00.000Z",
 *     },
 *     {
 *       id: 2,
 *       role: "assistant",
 *       content: "I'll create a login form...",
 *       createdAt: "2024-01-15T09:00:05.000Z",
 *       model: "claude-sonnet-4-20250514",
 *       timing: {...},
 *       aiCalls: [...],
 *       toolCalls: [...],
 *     },
 *   ],
 *   summary: {
 *     totalMessages: 2,
 *     userMessageCount: 1,
 *     assistantMessageCount: 1,
 *     totalToolCalls: 5,
 *     successfulToolCalls: 5,
 *     failedToolCalls: 0,
 *     totalAiCalls: 3,
 *     totalDurationMs: 5000,
 *     totalInputTokens: 2000,
 *     totalOutputTokens: 800,
 *     totalTokens: 2800,
 *     errorsCount: 0,
 *     cancelledCount: 0,
 *   },
 * };
 * ```
 */
export const SessionUploadPayloadSchema = z.object({
  /** Schema version for backwards compatibility */
  schemaVersion: z
    .literal(SESSION_UPLOAD_SCHEMA_VERSION)
    .describe("Schema version"),

  /** Unique identifier for this upload session */
  sessionId: z.string().describe("Unique identifier for this upload"),

  /** When this payload was uploaded (ISO 8601) */
  uploadedAt: z.string().datetime().describe("When this payload was uploaded"),

  /** Client environment information */
  client: ClientInfoSchema.describe("Client environment information"),

  /** Relevant settings at time of upload */
  settings: SettingsSnapshotSchema.describe(
    "Relevant settings at time of upload",
  ),

  /** App information */
  app: AppInfoSchema.describe("App information"),

  /** Chat information */
  chat: ChatInfoSchema.describe("Chat information"),

  /** All messages in the chat, in chronological order */
  messages: z
    .array(MessageInfoSchema)
    .describe("All messages in chronological order"),

  /** Summary statistics for quick analysis */
  summary: SessionSummarySchema.describe("Summary statistics"),
});

export type SessionUploadPayload = z.infer<typeof SessionUploadPayloadSchema>;

// =============================================================================
// IPC Contract
// =============================================================================

export const sessionUploadContracts = {
  uploadSession: defineContract({
    channel: "session:upload",
    input: z.object({
      url: z.string().describe("Signed URL to upload to"),
      payload: SessionUploadPayloadSchema.describe("Session upload payload"),
    }),
    output: z.void(),
  }),
} as const;

export const sessionUploadClient = createClient(sessionUploadContracts);
