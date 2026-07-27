// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { UserSettings, LargeLanguageModel } from "@/lib/schemas";
import type { AgentTool } from "@earendil-works/pi-agent-core";

// Mock the model runtime + stream fn so the factory does not construct the real
// pi Models singleton (which reads Dyad settings via electron).
const runtime = vi.hoisted(() => ({
  resolveDyadModel: vi.fn(),
  buildStreamOptions: vi.fn(),
  createDyadStreamFn: vi.fn(),
}));
vi.mock("./model_runtime", () => ({
  resolveDyadModel: runtime.resolveDyadModel,
}));
vi.mock("./stream_fn", () => ({
  buildStreamOptions: runtime.buildStreamOptions,
  createDyadStreamFn: runtime.createDyadStreamFn,
}));

import { createDyadAgent } from "./agent_factory";

const model: LargeLanguageModel = { provider: "openai", name: "gpt-5.2" };

function settings(partial: Partial<UserSettings> = {}): UserSettings {
  return partial as UserSettings;
}

const fakeTool = {
  name: "noop",
  label: "No-op",
  description: "does nothing",
  parameters: { type: "object" },
  execute: async () => ({ content: [], details: undefined }),
} as unknown as AgentTool<any>;

describe("createDyadAgent", () => {
  beforeEach(() => {
    runtime.resolveDyadModel.mockReset();
    runtime.buildStreamOptions.mockReset();
    runtime.createDyadStreamFn.mockReset();

    runtime.resolveDyadModel.mockReturnValue({ id: "gpt-5.2" });
    runtime.createDyadStreamFn.mockReturnValue(() => {
      throw new Error("streamFn should not be called in this test");
    });
  });

  it("seeds the agent with the resolved model, prompt, tools, and messages", async () => {
    runtime.buildStreamOptions.mockResolvedValue({ reasoning: "high" });

    const agent = await createDyadAgent({
      model,
      settings: settings({ thinkingBudget: "high" }),
      chatMode: "local-agent",
      systemPrompt: "you are a coding agent",
      tools: [fakeTool],
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
      sessionId: "chat-42",
      dyadRequestId: "request-42",
    });

    expect(runtime.resolveDyadModel).toHaveBeenCalledWith(model);
    expect(runtime.buildStreamOptions).toHaveBeenCalledWith(
      model,
      expect.anything(),
      "request-42",
    );
    expect(agent.state.systemPrompt).toBe("you are a coding agent");
    expect(agent.state.model).toEqual({ id: "gpt-5.2" });
    expect(agent.state.thinkingLevel).toBe("high");
    expect(agent.state.tools).toHaveLength(1);
    expect(agent.state.tools[0]?.name).toBe("noop");
    expect(agent.state.messages).toHaveLength(1);
    expect(agent.sessionId).toBe("chat-42");
  });

  it("defaults thinkingLevel to 'off' and tools/messages to empty when omitted", async () => {
    runtime.buildStreamOptions.mockResolvedValue({});

    const agent = await createDyadAgent({
      model,
      settings: settings(),
      chatMode: "ask",
      systemPrompt: "ask mode",
    });

    expect(agent.state.thinkingLevel).toBe("off");
    expect(agent.state.tools).toEqual([]);
    expect(agent.state.messages).toEqual([]);
  });
});
