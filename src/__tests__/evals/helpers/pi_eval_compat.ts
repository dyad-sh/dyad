import {
  Agent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { Api, Message, Model, Models } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";
import { z } from "zod";

export interface LanguageModel {
  model: Model<Api>;
  models: Models;
}

export interface EvalTool {
  description: string;
  inputSchema: z.ZodType;
  execute: (args: any) => Promise<string> | string;
}

export type ToolSet = Record<string, EvalTool>;

interface StepLimit {
  maxSteps: number;
}

export function stepCountIs(maxSteps: number): StepLimit {
  return { maxSteps };
}

interface GenerateTextParams {
  model: LanguageModel;
  system?: string;
  prompt?: string;
  messages?: any[];
  tools?: ToolSet;
  toolChoice?: "none";
  stopWhen?: StepLimit;
  maxRetries?: number;
}

function zodToTypebox(schema: z.ZodType): TSchema {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  delete jsonSchema.$schema;
  return Type.Unsafe(jsonSchema);
}

function toAgentTools(tools: ToolSet | undefined): AgentTool[] {
  return Object.entries(tools ?? {}).map(([name, tool]) => ({
    name,
    label: name,
    description: tool.description,
    parameters: zodToTypebox(tool.inputSchema),
    execute: async (_toolCallId, args) => ({
      content: [{ type: "text" as const, text: await tool.execute(args) }],
      details: {},
    }),
  }));
}

function normalizeMessages(messages: any[] | undefined): AgentMessage[] {
  return (messages ?? []).map((message, index) => {
    if (Array.isArray(message.content)) {
      return message as AgentMessage;
    }
    if (message.role !== "user") {
      throw new Error(`Unsupported eval message at index ${index}`);
    }
    return {
      role: "user",
      content: [{ type: "text", text: String(message.content ?? "") }],
      timestamp: Date.now(),
    } satisfies AgentMessage;
  });
}

function assistantText(message: AgentMessage | undefined): string {
  if (message?.role !== "assistant") return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (message): message is Message =>
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult",
  );
}

export async function generateText(params: GenerateTextParams) {
  const initialMessages = normalizeMessages(params.messages);
  const agent = new Agent({
    streamFn: (model, context, options) =>
      params.model.models.streamSimple(model, context, {
        ...options,
        maxRetries: params.maxRetries,
      }),
    convertToLlm,
    toolExecution: "sequential",
    initialState: {
      systemPrompt: params.system ?? "",
      model: params.model.model,
      thinkingLevel: "off",
      tools: params.toolChoice === "none" ? [] : toAgentTools(params.tools),
      messages: initialMessages,
    },
  });

  let steps = 0;
  let limitReached = false;
  agent.subscribe((event) => {
    if (event.type !== "turn_end") return;
    steps += 1;
    if (params.stopWhen && steps >= params.stopWhen.maxSteps) {
      limitReached = true;
      agent.abort();
    }
  });

  if (params.messages) {
    await agent.continue();
  } else {
    await agent.prompt(params.prompt ?? "");
  }
  if (agent.state.errorMessage && !limitReached) {
    throw new Error(agent.state.errorMessage);
  }

  const generatedStart = initialMessages.length + (params.messages ? 0 : 1);
  const generatedMessages = agent.state.messages.slice(generatedStart);
  const assistantMessages = generatedMessages.filter(
    (message) => message.role === "assistant",
  );
  const lastAssistant = assistantMessages.at(-1);
  const totalUsage = assistantMessages.reduce(
    (total, message) => ({
      inputTokens: total.inputTokens + message.usage.input,
      outputTokens: total.outputTokens + message.usage.output,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  return {
    text: assistantText(lastAssistant),
    steps: Array.from({ length: steps }, () => ({})),
    response: { messages: generatedMessages },
    totalUsage,
    usage: totalUsage,
  };
}
