import { streamText } from "ai";
import { z } from "zod";
import log from "electron-log";
import { getModelClient } from "@/ipc/utils/get_model_client";
import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";
import { buildMcpConsentSystemPrompt } from "@/prompts/mcp_consent_policy";
import type { McpAutoApproveResult } from "@/ipc/utils/mcp_consent";
import { fastTextOutput } from "@/ipc/utils/stream_text_utils";
import {
  formatRecentTurns,
  getRecentTurnsForConsent,
  type RecentTurn,
} from "./mcp_consent_context";

const logger = log.scope("mcp-auto-consent");

// Fixed classifier model routed through the Dyad Pro engine gateway.
const MCP_CONSENT_MODEL: LargeLanguageModel = {
  name: "gpt-5.4-mini",
  provider: "openai",
};

const CLASSIFIER_TIMEOUT_MS = 8000;

export interface McpConsentDecision {
  decision: "allow" | "ask";
  reason: string;
}

export interface ClassifyMcpToolConsentInput {
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputSchema?: unknown;
  args: unknown;
  recentTurns: RecentTurn[];
  settings: UserSettings;
}

// Fail-closed default: when anything goes wrong, ask.
function ask(reason: string): McpConsentDecision {
  return { decision: "ask", reason };
}

// reason is emitted first so it acts as a brief reasoning step before the
// verdict, not a post-hoc rationalization.
const rawDecisionSchema = z.object({
  reason: z.string().optional(),
  decision: z.enum(["allow", "ask"]),
});

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

function buildUserPayload(input: ClassifyMcpToolConsentInput): string {
  const schema = input.inputSchema
    ? JSON.stringify(input.inputSchema)
    : "(none)";
  const lines = [
    `MCP server: ${input.serverName}`,
    `Tool: ${input.toolName}`,
    `Description: ${input.toolDescription ?? "(none)"}`,
    `Input schema: ${schema}`,
    `Arguments: ${JSON.stringify(input.args)}`,
  ];
  if (input.recentTurns.length > 0) {
    lines.push(
      "",
      "Recent conversation (oldest first):",
      formatRecentTurns(input.recentTurns),
    );
  }
  return lines.join("\n");
}

export async function classifyMcpToolConsent(
  input: ClassifyMcpToolConsentInput,
): Promise<McpConsentDecision> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Race the stream against a timeout that rejects, so a stuck request can
  // never block the tool call. On timeout, abort() cancels the in-flight
  // request so it doesn't keep running after we've moved on.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("classifier timeout"));
    }, CLASSIFIER_TIMEOUT_MS);
  });
  try {
    const { modelClient } = await getModelClient(
      MCP_CONSENT_MODEL,
      input.settings,
    );

    const stream = streamText({
      output: fastTextOutput(),
      model: modelClient.model,
      system: buildMcpConsentSystemPrompt(),
      maxRetries: 1,
      abortSignal: controller.signal,
      messages: [{ role: "user", content: buildUserPayload(input) }],
    });

    // If the timeout wins the race, stream.text is orphaned and may reject
    // later (when abort propagates). Swallow it so it can't become an
    // unhandled rejection that accumulates across many calls.
    const textPromise = Promise.resolve(stream.text);
    textPromise.catch(() => {});
    const text = await Promise.race([textPromise, timeout]);
    const json = extractJson(text);
    if (!json) return ask("Classifier returned no parseable decision.");

    const parsed = rawDecisionSchema.parse(JSON.parse(json));
    const decision: McpConsentDecision = {
      decision: parsed.decision,
      reason: parsed.reason?.trim() || "No reason provided.",
    };
    logger.info(
      `${input.serverName}/${input.toolName} -> ${decision.decision}: ${decision.reason}`,
    );
    return decision;
  } catch (error) {
    logger.warn(
      `Classifier failed for ${input.serverName}/${input.toolName}, asking:`,
      error,
    );
    return ask("Could not evaluate the tool call automatically.");
  } finally {
    clearTimeout(timer);
  }
}

// Builds the auto-approve callback for requireMcpToolConsent, or undefined when
// the feature is off or the turn is running in Dyad Free mode. Shared by both
// agent MCP paths (sandbox host functions and directly-registered tools) so
// auto-approval behaves the same regardless of how the tool is plumbed.
export function buildMcpAutoApprove(params: {
  settings: UserSettings;
  isDyadPro: boolean;
  freeModelMode?: boolean;
  chatId: number;
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputSchema?: unknown;
  args: unknown;
}): (() => Promise<McpAutoApproveResult>) | undefined {
  if (
    !params.settings.autoApproveSafeMcpTools ||
    !params.isDyadPro ||
    params.freeModelMode
  ) {
    return undefined;
  }
  return async () => {
    // On error, fall through to the consent prompt. Without this, the error
    // propagates and the tool call errors out instead of asking.
    try {
      const recentTurns = await getRecentTurnsForConsent(params.chatId);
      const decision = await classifyMcpToolConsent({
        serverName: params.serverName,
        toolName: params.toolName,
        toolDescription: params.toolDescription,
        inputSchema: params.inputSchema,
        args: params.args,
        recentTurns,
        settings: params.settings,
      });
      return {
        approved: decision.decision === "allow",
        reason: decision.reason,
      };
    } catch {
      return { approved: false };
    }
  };
}
