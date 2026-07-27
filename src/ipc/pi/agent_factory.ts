/**
 * pi Agent factory.
 *
 * Assembles a pi-agent-core `Agent` from Dyad settings: the stream function
 * (see ./stream_fn.ts), the resolved pi model (see ./model_runtime.ts), a
 * system prompt, and an already-selected tool set. Tool selection stays at the
 * turn boundary so the factory remains independently testable.
 */

import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

import type { ChatMode, LargeLanguageModel, UserSettings } from "@/lib/schemas";
import { resolveDyadModel } from "./model_runtime";
import { buildStreamOptions, createDyadStreamFn } from "./stream_fn";

export interface CreateDyadAgentParams {
  model: LargeLanguageModel;
  settings: UserSettings;
  chatMode: ChatMode;
  systemPrompt: string;
  /**
   * Tools available to the agent. Selection by chat mode happens at the call
   * site; the factory does not invent tools.
   */
  tools?: AgentTool<any>[];
  /** Initial transcript to seed the agent with (rebuilt from the DB by session_bridge). */
  messages?: AgentMessage[];
  /** Session id forwarded to providers for cache-aware backends. */
  sessionId?: string;
  /** Correlation id forwarded to the provider request headers. */
  dyadRequestId?: string;
}

/**
 * Default `convertToLlm`: the agent transcript already holds pi `Message`s
 * (Dyad has no custom AgentMessage variants yet), so this is a passthrough
 * that drops anything that isn't a standard LLM message.
 */
function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (m): m is Message =>
      m.role === "user" || m.role === "assistant" || m.role === "toolResult",
  );
}

/**
 * Build a pi `Agent` bound to Dyad's model runtime and settings.
 *
 * The caller subscribes to the returned agent and translates pi `AgentEvent`s
 * into Dyad's chat-stream protocol payloads.
 */
export async function createDyadAgent(
  params: CreateDyadAgentParams,
): Promise<Agent> {
  const {
    model,
    settings,
    systemPrompt,
    tools,
    messages,
    sessionId,
    dyadRequestId,
  } = params;

  const piModel = await resolveDyadModel(model);
  const baseOptions = await buildStreamOptions(model, settings, dyadRequestId);
  const streamFn = createDyadStreamFn(baseOptions);

  return new Agent({
    streamFn,
    convertToLlm,
    sessionId,
    initialState: {
      systemPrompt,
      model: piModel,
      thinkingLevel: baseOptions.reasoning ?? "off",
      tools: tools ?? [],
      messages: messages ?? [],
    },
  });
}
