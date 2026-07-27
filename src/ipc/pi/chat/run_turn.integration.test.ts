// @vitest-environment node
/**
 * Real integration test for runTurn: a faux pi provider drives a real pi Agent
 * loop through runTurn end-to-end, and we assert the translated chunk stream
 * and the final TurnOutcome. No Electron, no network, no mocks of pi itself.
 *
 * This exercises the actual Step-3 chat-pipeline seam (agent_factory ->
 * event_translator -> run_turn), which is the "real integration test against
 * the post-rewrite chat pipeline" the migration requires.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createModels } from "@earendil-works/pi-ai";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import type { ChatResponseChunk } from "@/ipc/types";

// runTurn builds the agent via createDyadAgent -> getPiModels()/resolveDyadModel.
// We stub the model runtime so the agent streams through our faux provider
// instead of the real builtin catalog, and stub stream_fn's option builder so
// it doesn't reach into electron-backed settings.
const h = vi.hoisted(() => {
  const models = null as unknown as {
    current: ReturnType<typeof createModels>;
  };
  return { models };
});

vi.mock("@/ipc/pi/model_runtime", () => ({
  getPiModels: () => h.models.current,
  resolveDyadModel: (model: { provider: string; name: string }) =>
    h.models.current.getModel(model.provider, model.name),
}));

vi.mock("@/ipc/pi/stream_fn", async () => {
  const actual =
    await vi.importActual<typeof import("@/ipc/pi/stream_fn")>(
      "@/ipc/pi/stream_fn",
    );
  return {
    ...actual,
    // Avoid token_utils -> electron settings; return empty base options.
    buildStreamOptions: async () => ({}),
    createDyadStreamFn: () => {
      const models = h.models.current;
      return (model: any, context: any, options: any) =>
        models.streamSimple(model, context, options);
    },
  };
});

import { runTurn } from "./run_turn";

function setupFauxModels() {
  const faux = fauxProvider({
    provider: "openai",
    models: [{ id: "gpt-test", name: "gpt-test" }],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  h.models = { current: models } as any;
  // The hoisted object is captured by reference in the mocks above.
  (h as any).models = { current: models };
  return { faux, models };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTurn (real pi Agent via faux provider)", () => {
  it("streams a text-only turn and returns final content", async () => {
    const { faux } = setupFauxModels();
    faux.setResponses([fauxAssistantMessage("Hello from pi")]);

    const priorMessages = [
      {
        role: "user" as const,
        content: "Earlier question",
        timestamp: 100,
      },
      fauxAssistantMessage("Earlier answer"),
    ];

    const chunks: ChatResponseChunk[] = [];
    const outcome = await runTurn({
      chatId: 1,
      streamingMessageId: 10,
      model: { provider: "openai", name: "gpt-test" },
      settings: {} as any,
      chatMode: "local-agent",
      systemPrompt: "test",
      prompt: "hi",
      tools: [],
      messages: priorMessages,
      onChunk: (c) => {
        chunks.push(c);
      },
    });

    expect(outcome.aborted).toBe(false);
    expect(outcome.errorMessage).toBeUndefined();
    expect(outcome.content).toBe("Hello from pi");
    // At least one patch chunk carried the streamed text.
    const reconstructed = reconstructFromPatches(chunks);
    expect(reconstructed).toBe("Hello from pi");
    expect(outcome.transcript.slice(0, 2)).toEqual(priorMessages);
    expect(outcome.turnMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(outcome.transcript.slice(2)).toEqual(outcome.turnMessages);
  });

  it("runs a tool call then final text, folding tool XML into content", async () => {
    const { faux } = setupFauxModels();
    // Step 1: assistant calls the tool. Step 2: assistant emits final text.
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("echo_tool", { value: "hi" })]),
      fauxAssistantMessage([fauxText("done")]),
    ]);

    const echoTool: AgentTool<any, any> = {
      name: "echo_tool",
      label: "echo",
      description: "echo a value",
      parameters: Type.Object({ value: Type.String() }),
      async execute() {
        return {
          content: [{ type: "text", text: "echoed: hi" }],
          details: {
            toolName: "echo_tool",
            xml: "<dyad-echo>hi</dyad-echo>",
            appendedUserMessages: [],
          },
        };
      },
    };

    const chunks: ChatResponseChunk[] = [];
    const outcome = await runTurn({
      chatId: 2,
      streamingMessageId: 20,
      model: { provider: "openai", name: "gpt-test" },
      settings: {} as any,
      chatMode: "local-agent",
      systemPrompt: "test",
      prompt: "use the tool",
      tools: [echoTool],
      onChunk: (c) => {
        chunks.push(c);
      },
    });

    expect(outcome.aborted).toBe(false);
    // Final content folds the tool XML plus the closing assistant text.
    expect(outcome.content).toContain("<dyad-echo>hi</dyad-echo>");
    expect(outcome.content).toContain("done");
    // A preview overlay was emitted while the tool ran, then cleared.
    const previews = chunks.filter((c) => c.streamingPreview !== undefined);
    expect(previews.length).toBeGreaterThan(0);
    expect(previews[previews.length - 1].streamingPreview?.content).toBe("");
  });

  it("checkpoints a complete tool call and result before the next provider turn", async () => {
    const { faux } = setupFauxModels();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("echo_tool", { value: "hi" })]),
      fauxAssistantMessage("done"),
    ]);
    const checkpoints: string[][] = [];
    const echoTool: AgentTool<any, any> = {
      name: "echo_tool",
      label: "echo",
      description: "echo",
      parameters: Type.Object({ value: Type.String() }),
      async execute() {
        return { content: [{ type: "text", text: "echoed" }], details: {} };
      },
    };

    await runTurn({
      chatId: 22,
      streamingMessageId: 220,
      model: { provider: "openai", name: "gpt-test" },
      settings: {} as any,
      chatMode: "local-agent",
      systemPrompt: "test",
      prompt: "use tool",
      tools: [echoTool],
      onChunk: () => {},
      onCheckpoint: (messages) => {
        checkpoints.push(messages.map((message) => message.role));
      },
    });

    expect(checkpoints).toContainEqual(["user", "assistant", "toolResult"]);
  });

  it("folds captured renderer XML into failed tool results", async () => {
    const { faux } = setupFauxModels();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("failing_tool", {})]),
      fauxAssistantMessage([fauxText("handled")]),
    ]);

    const failingTool: AgentTool<any, any> = {
      name: "failing_tool",
      label: "failing",
      description: "always fails",
      parameters: Type.Object({}),
      async execute() {
        throw new Error("tool failed");
      },
    };
    const errorXml =
      '<dyad-output type="error" message="Tool failed">details</dyad-output>';
    const takeToolErrorXml = vi.fn(() => errorXml);
    const chunks: ChatResponseChunk[] = [];

    const outcome = await runTurn({
      chatId: 21,
      streamingMessageId: 210,
      model: { provider: "openai", name: "gpt-test" },
      settings: {} as any,
      chatMode: "local-agent",
      systemPrompt: "test",
      prompt: "use the failing tool",
      tools: [failingTool],
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
      takeToolErrorXml,
    });

    expect(takeToolErrorXml).toHaveBeenCalledTimes(1);
    expect(outcome.content).toBe(`${errorXml}\nhandled`);
    expect(reconstructFromPatches(chunks)).toBe(outcome.content);
    expect(
      outcome.turnMessages.find((message) => message.role === "toolResult"),
    ).toMatchObject({
      details: {
        toolName: "failing_tool",
        xml: errorXml,
        appendedUserMessages: [],
      },
      isError: true,
    });
  });

  it("steers tool-appended text and images into the next provider turn", async () => {
    const { faux } = setupFauxModels();
    let nextTurnMessages: any[] = [];
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("screenshot_tool", {})]),
      (context) => {
        nextTurnMessages = context.messages;
        return fauxAssistantMessage("screenshot received");
      },
    ]);

    const screenshotTool: AgentTool<any, any> = {
      name: "screenshot_tool",
      label: "screenshot",
      description: "attach a screenshot",
      parameters: Type.Object({}),
      async execute() {
        return {
          content: [{ type: "text", text: "test failed" }],
          details: {
            toolName: "screenshot_tool",
            appendedUserMessages: [
              [
                { type: "text", text: "Failure screenshot:" },
                {
                  type: "image-url",
                  url: "data:image/png;base64,aW1hZ2U=",
                },
              ],
            ],
          },
        };
      },
    };

    const outcome = await runTurn({
      chatId: 3,
      streamingMessageId: 30,
      model: { provider: "openai", name: "gpt-test" },
      settings: {} as any,
      chatMode: "local-agent",
      systemPrompt: "test",
      prompt: "run tests",
      tools: [screenshotTool],
      onChunk: () => {},
    });

    expect(nextTurnMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "user",
    ]);
    expect(nextTurnMessages.at(-1)?.content).toEqual([
      { type: "text", text: "Failure screenshot:" },
      { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
    ]);
    expect(outcome.turnMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "user",
      "assistant",
    ]);
  });

  it("retries a transient stream failure without retaining partial text", async () => {
    const { faux } = setupFauxModels();
    faux.setResponses([
      fauxAssistantMessage("Partial response before connection dr", {
        stopReason: "error",
        errorMessage: "terminated",
      }),
      fauxAssistantMessage("Recovered response"),
    ]);

    const chunks: ChatResponseChunk[] = [];
    const outcome = await runTurn({
      chatId: 4,
      streamingMessageId: 40,
      model: { provider: "openai", name: "gpt-test" },
      settings: {} as any,
      chatMode: "local-agent",
      systemPrompt: "test",
      prompt: "recover",
      tools: [],
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(faux.state.callCount).toBe(2);
    expect(outcome.errorMessage).toBeUndefined();
    expect(outcome.content).toBe("Recovered response");
    expect(reconstructFromPatches(chunks)).toBe("Recovered response");
  });

  it("does not repeat completed tool execution when retrying", async () => {
    const { faux } = setupFauxModels();
    faux.setResponses([
      fauxAssistantMessage([
        fauxText("Creating the file."),
        fauxToolCall("write_tool", { path: "src/recovered.ts" }),
      ]),
      fauxAssistantMessage("Partial response before connection dr", {
        stopReason: "error",
        errorMessage: "terminated",
      }),
      fauxAssistantMessage("Created the file."),
    ]);

    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "wrote file" }],
      details: {
        toolName: "write_tool",
        xml: "<dyad-write path='src/recovered.ts'>done</dyad-write>",
        appendedUserMessages: [],
      },
    }));
    const writeTool: AgentTool<any, any> = {
      name: "write_tool",
      label: "write",
      description: "write a file",
      parameters: Type.Object({ path: Type.String() }),
      execute,
    };

    const chunks: ChatResponseChunk[] = [];
    const outcome = await runTurn({
      chatId: 5,
      streamingMessageId: 50,
      model: { provider: "openai", name: "gpt-test" },
      settings: {} as any,
      chatMode: "local-agent",
      systemPrompt: "test",
      prompt: "create the file",
      tools: [writeTool],
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(faux.state.callCount).toBe(3);
    expect(outcome.errorMessage).toBeUndefined();
    expect(outcome.content).toBe(
      "Creating the file.\n" +
        "<dyad-write path='src/recovered.ts'>done</dyad-write>\n" +
        "Created the file.",
    );
    expect(reconstructFromPatches(chunks)).toBe(outcome.content);
  });

  it("runs one synthetic follow-up without persisting its prompt", async () => {
    const { faux } = setupFauxModels();
    let followUpContext: any[] = [];
    faux.setResponses([
      fauxAssistantMessage("First pass complete."),
      (context) => {
        followUpContext = context.messages;
        return fauxAssistantMessage("All tasks complete.");
      },
    ]);

    let followUpChecks = 0;
    const outcome = await runTurn({
      chatId: 6,
      streamingMessageId: 60,
      model: { provider: "openai", name: "gpt-test" },
      settings: {} as any,
      chatMode: "local-agent",
      systemPrompt: "test",
      prompt: "finish the tasks",
      tools: [],
      onChunk: () => {},
      getFollowUpPrompt: () => {
        followUpChecks++;
        return "You have 2 incomplete todo(s). Please continue.";
      },
    });

    expect(faux.state.callCount).toBe(2);
    expect(followUpChecks).toBe(1);
    expect(followUpContext.at(-1)?.role).toBe("user");
    expect(followUpContext.at(-1)?.content).toEqual([
      {
        type: "text",
        text: "You have 2 incomplete todo(s). Please continue.",
      },
    ]);
    expect(outcome.content).toBe("First pass complete.\nAll tasks complete.");
    expect(
      outcome.turnMessages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });
});

/** Reconstruct the streamed content from tail-only streamingPatch chunks. */
function reconstructFromPatches(chunks: ChatResponseChunk[]): string {
  let content = "";
  for (const c of chunks) {
    if (c.streamingPatch) {
      content =
        content.slice(0, c.streamingPatch.offset) + c.streamingPatch.content;
    }
  }
  return content;
}
