import { eq } from "drizzle-orm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { db } from "../../../db";
import { agentOsAgents } from "../../../db/schema";
import type { UserSettings } from "@/lib/schemas";

/**
 * Resolves the Agent OS agent selected as the Meta Human OS voice brain.
 *
 * Agents registered on the Agents page expose an OpenAI-compatible endpoint,
 * so the brain is just a model client pointed at that endpoint — the same
 * shape every other provider produces. The agent's API key stays in the main
 * process; it is read here and never sent to the renderer.
 */

export interface JarvisBrainAgent {
  id: string;
  name: string;
  model: LanguageModel;
  /** Endpoint shown in the UI — safe to display, carries no credentials. */
  endpoint: string;
  modelName: string;
}

/** Strip a trailing `/chat/completions` so the SDK can append its own path. */
export function normalizeAgentBaseUrl(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "");
}

export function getBrainAgentRow(settings: UserSettings) {
  const agentId = settings.jarvis?.brainAgentId;
  if (!agentId) return null;

  const row = db
    .select()
    .from(agentOsAgents)
    .where(eq(agentOsAgents.id, agentId))
    .get();

  if (!row || !row.enabled) return null;
  if (!/^https?:\/\//i.test(row.endpoint?.trim() ?? "")) return null;
  // MCP servers expose tools, not an OpenAI-compatible chat completions API,
  // so they cannot answer a voice turn even if one is stored in settings.
  if (row.type === "MCP") return null;
  return row;
}

export function resolveBrainAgent(
  settings: UserSettings,
): JarvisBrainAgent | null {
  const row = getBrainAgentRow(settings);
  if (!row) return null;

  const baseURL = normalizeAgentBaseUrl(row.endpoint);
  const provider = createOpenAICompatible({
    name: `agent-os:${row.id}`,
    baseURL,
    ...(row.apiKey ? { apiKey: row.apiKey } : {}),
  });
  const modelName = row.model?.trim() || "default";

  return {
    id: row.id,
    name: row.name,
    endpoint: baseURL,
    modelName,
    model: provider(modelName),
  };
}
