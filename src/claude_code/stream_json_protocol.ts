/**
 * Types and parsing for the Claude Code CLI `stream-json` protocol
 * (`claude -p --output-format stream-json --input-format stream-json`).
 *
 * Verified against Claude Code 2.1.260. Only the fields Dyad consumes are
 * modelled; everything else passes through as `unknown`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Outbound (Dyad -> CLI stdin)
// ---------------------------------------------------------------------------

export interface CliUserMessageInput {
  type: "user";
  message: { role: "user"; content: string | CliUserContentBlock[] };
}

export type CliUserContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

export interface CliControlResponseInput {
  type: "control_response";
  response:
    | {
        subtype: "success";
        request_id: string;
        response: Record<string, unknown> | null;
      }
    | { subtype: "error"; request_id: string; error: string };
}

export interface CliInterruptRequestInput {
  type: "control_request";
  request_id: string;
  request: { subtype: "interrupt" };
}

export type CliStdinMessage =
  | CliUserMessageInput
  | CliControlResponseInput
  | CliInterruptRequestInput;

// ---------------------------------------------------------------------------
// Inbound (CLI stdout -> Dyad)
// ---------------------------------------------------------------------------

const UsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    cache_creation: z
      .object({
        ephemeral_5m_input_tokens: z.number().optional(),
        ephemeral_1h_input_tokens: z.number().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export type CliUsage = z.infer<typeof UsageSchema>;

const ModelUsageEntrySchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadInputTokens: z.number().optional(),
    cacheCreationInputTokens: z.number().optional(),
    costUSD: z.number().optional(),
    canonicalModel: z.string().optional(),
    costBasis: z.string().optional(),
    thinkingTokens: z.number().optional(),
  })
  .passthrough();

export type CliModelUsageEntry = z.infer<typeof ModelUsageEntrySchema>;

const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z
    .object({ type: z.literal("thinking"), thinking: z.string().optional() })
    .passthrough(),
  z
    .object({
      type: z.literal("tool_use"),
      id: z.string(),
      name: z.string(),
      input: z.unknown(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("tool_result"),
      tool_use_id: z.string(),
      content: z.unknown().optional(),
      is_error: z.boolean().optional(),
    })
    .passthrough(),
]);

export type CliContentBlock = z.infer<typeof ContentBlockSchema>;

const SystemInitSchema = z
  .object({
    type: z.literal("system"),
    subtype: z.literal("init"),
    session_id: z.string(),
    model: z.string().optional(),
    tools: z.array(z.string()).optional(),
    mcp_servers: z
      .array(z.object({ name: z.string(), status: z.string() }).passthrough())
      .optional(),
    permissionMode: z.string().optional(),
    apiKeySource: z.string().optional(),
    claude_code_version: z.string().optional(),
  })
  .passthrough();

const SystemOtherSchema = z
  .object({
    type: z.literal("system"),
    subtype: z.string(),
  })
  .passthrough();

const AssistantSchema = z
  .object({
    type: z.literal("assistant"),
    parent_tool_use_id: z.string().nullable().optional(),
    message: z
      .object({
        model: z.string().optional(),
        id: z.string().optional(),
        content: z.array(ContentBlockSchema).default([]),
        usage: UsageSchema.optional(),
        stop_reason: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const UserSchema = z
  .object({
    type: z.literal("user"),
    parent_tool_use_id: z.string().nullable().optional(),
    message: z
      .object({
        content: z.union([z.string(), z.array(ContentBlockSchema)]),
      })
      .passthrough(),
    tool_use_result: z.unknown().optional(),
  })
  .passthrough();

const StreamEventSchema = z
  .object({
    type: z.literal("stream_event"),
    parent_tool_use_id: z.string().nullable().optional(),
    event: z
      .object({
        type: z.string(),
        index: z.number().optional(),
        delta: z
          .object({
            type: z.string().optional(),
            text: z.string().optional(),
            partial_json: z.string().optional(),
            thinking: z.string().optional(),
            stop_reason: z.string().nullable().optional(),
          })
          .passthrough()
          .optional(),
        content_block: z
          .object({
            type: z.string(),
            id: z.string().optional(),
            name: z.string().optional(),
            text: z.string().optional(),
          })
          .passthrough()
          .optional(),
        message: z
          .object({ model: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CanUseToolRequestSchema = z
  .object({
    subtype: z.literal("can_use_tool"),
    tool_name: z.string(),
    display_name: z.string().optional(),
    input: z.unknown(),
    description: z.string().optional(),
    tool_use_id: z.string().optional(),
  })
  .passthrough();

const McpMessageRequestSchema = z
  .object({
    subtype: z.literal("mcp_message"),
    server_name: z.string(),
    message: z
      .object({
        jsonrpc: z.literal("2.0").optional(),
        id: z.union([z.number(), z.string()]).optional(),
        method: z.string(),
        params: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const OtherControlRequestSchema = z
  .object({ subtype: z.string() })
  .passthrough();

const ControlRequestSchema = z
  .object({
    type: z.literal("control_request"),
    request_id: z.string(),
    request: z.union([
      CanUseToolRequestSchema,
      McpMessageRequestSchema,
      OtherControlRequestSchema,
    ]),
  })
  .passthrough();

const ControlResponseSchema = z
  .object({
    type: z.literal("control_response"),
    response: z
      .object({
        subtype: z.string(),
        request_id: z.string(),
        response: z.unknown().optional(),
        error: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ResultSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    session_id: z.string().optional(),
    result: z.string().optional(),
    stop_reason: z.string().nullable().optional(),
    terminal_reason: z.string().optional(),
    num_turns: z.number().optional(),
    total_cost_usd: z.number().optional(),
    usage: UsageSchema.optional(),
    modelUsage: z.record(z.string(), ModelUsageEntrySchema).optional(),
    permission_denials: z.array(z.unknown()).optional(),
    api_error_status: z.number().nullable().optional(),
    errors: z.array(z.unknown()).optional(),
  })
  .passthrough();

const RateLimitSchema = z
  .object({
    type: z.literal("rate_limit_event"),
    rate_limit_info: z
      .object({
        status: z.string().optional(),
        resetsAt: z.number().optional(),
        rateLimitType: z.string().optional(),
        isUsingOverage: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const CliEventSchema = z.union([
  SystemInitSchema,
  SystemOtherSchema,
  AssistantSchema,
  UserSchema,
  StreamEventSchema,
  ControlRequestSchema,
  ControlResponseSchema,
  ResultSchema,
  RateLimitSchema,
]);

export type CliSystemInitEvent = z.infer<typeof SystemInitSchema>;
export type CliAssistantEvent = z.infer<typeof AssistantSchema>;
export type CliUserEvent = z.infer<typeof UserSchema>;
export type CliStreamEvent = z.infer<typeof StreamEventSchema>;
export type CliControlRequestEvent = z.infer<typeof ControlRequestSchema>;
export type CliCanUseToolRequest = z.infer<typeof CanUseToolRequestSchema>;
export type CliMcpMessageRequest = z.infer<typeof McpMessageRequestSchema>;
export type CliControlResponseEvent = z.infer<typeof ControlResponseSchema>;
export type CliResultEvent = z.infer<typeof ResultSchema>;
export type CliRateLimitEvent = z.infer<typeof RateLimitSchema>;
export type CliEvent = z.infer<typeof CliEventSchema>;

export type ParsedCliLine =
  | { kind: "event"; event: CliEvent }
  | { kind: "unknown"; raw: string; value: unknown }
  | { kind: "invalid"; raw: string };

/**
 * Parse one stdout line. Unknown-but-valid JSON objects are surfaced as
 * `unknown` so future event types never abort a turn; non-JSON lines are
 * reported as `invalid` (the CLI occasionally prints diagnostics to stdout).
 */
export function parseCliLine(raw: string): ParsedCliLine | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { kind: "invalid", raw: trimmed };
  }
  const parsed = CliEventSchema.safeParse(value);
  if (parsed.success) {
    return { kind: "event", event: parsed.data };
  }
  return { kind: "unknown", raw: trimmed, value };
}

export function isCanUseToolRequest(
  request: CliControlRequestEvent["request"],
): request is CliCanUseToolRequest {
  return request.subtype === "can_use_tool";
}

export function isMcpMessageRequest(
  request: CliControlRequestEvent["request"],
): request is CliMcpMessageRequest {
  return request.subtype === "mcp_message";
}

/** Extract plain text from a tool_result content payload. */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          (part as { type: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("\n");
  }
  if (content == null) {
    return "";
  }
  return JSON.stringify(content);
}
