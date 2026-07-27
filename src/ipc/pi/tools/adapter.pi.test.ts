// @vitest-environment node
/**
 * Real pi Agent integration test for the Dyad tool adapter.
 *
 * Unlike adapter.test.ts (which unit-tests the wrapper in isolation), this
 * drives an actual pi-agent-core `Agent` loop end to end using pi's in-process
 * `faux` provider — no mocked pi internals, no network, no API key. It proves
 * the whole bridge works together: the agent asks for a tool call, pi validates
 * the arguments against the adapter's typebox schema, the adapter runs the
 * Dyad ToolDefinition (through the consent gate), and the tool result flows
 * back into the transcript so the agent can produce a final answer.
 *
 * This is the "run a real request" checkpoint for Steps 1-2 of the pi
 * migration (see plans/pi-sdk-glowing-volcano.md).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

// Consent is exercised through the ToolDefinition's ctx.requireConsent below,
// so we don't need the real settings-backed consent policy here. Stub the
// consent helper to a straight pass-through of ctx.requireConsent.
vi.mock("./dyad/tool_invocation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./dyad/tool_invocation")>();
  const { DyadError, DyadErrorKind } = await import("@/errors/dyad_error");
  return {
    ...actual,
    requireToolConsentOrThrow: async (tool: any, args: any, ctx: any) => {
      const allowed = await ctx.requireConsent({
        toolName: tool.name,
        toolDescription: tool.description,
        inputPreview: tool.getConsentPreview?.(args) ?? null,
        metadata: tool.getConsentMetadata?.(args) ?? null,
      });
      if (!allowed) {
        throw new DyadError(
          `User denied permission for ${tool.name}`,
          DyadErrorKind.UserCancelled,
        );
      }
    },
  };
});

import { z } from "zod";
import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

import type { AgentContext, ToolDefinition } from "./dyad/types";
import { adaptTool } from "./adapter";

/**
 * A tiny Dyad-style ToolDefinition that echoes its input. It records whether
 * it was executed and captures the args it received, and it emits a
 * `<dyad-echo>` XML fragment so we can assert the XML-capture seam works.
 */
function makeEchoTool(record: {
  executed: boolean;
  receivedText?: string;
  consentAsked: boolean;
}): ToolDefinition<{ text: string }> {
  return {
    name: "echo",
    description: "Echo the provided text back.",
    inputSchema: z.object({
      text: z.string().min(1).describe("the text to echo"),
    }),
    defaultConsent: "always",
    execute: async (args, ctx: AgentContext) => {
      record.executed = true;
      record.receivedText = args.text;
      ctx.onXmlComplete(`<dyad-echo>${args.text}</dyad-echo>`);
      return `echoed: ${args.text}`;
    },
  };
}

describe("pi Agent + Dyad tool adapter (real loop, faux provider)", () => {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });

  afterEach(() => {
    faux.setResponses([]);
  });

  it("runs prompt -> toolCall -> toolResult -> final text end to end", async () => {
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();

    const record = {
      executed: false,
      receivedText: undefined as string | undefined,
      consentAsked: false,
    };
    let capturedXml: string | undefined;

    const echoTool = makeEchoTool(record);
    const adaptedWithConsent = adaptTool(echoTool, {
      contextFactory: ({ onXml }) => {
        return {
          requireConsent: async () => {
            record.consentAsked = true;
            return true;
          },
          onXmlComplete: (xml: string) => {
            capturedXml = xml;
            onXml(xml);
          },
          onXmlStream: (xml: string) => {
            capturedXml = xml;
            onXml(xml);
          },
          appendUserMessage: () => {},
          onUpdateTodos: () => {},
          chatId: 1,
          appId: 1,
        } as unknown as AgentContext;
      },
    });

    // Script the faux LM: first turn asks to call echo, second turn answers.
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("echo", { text: "hello pi" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("Done: hello pi")], {
        stopReason: "stop",
      }),
    ]);

    const events: AgentEvent[] = [];
    const agent = new Agent({
      streamFn: (m, ctx, opts) => models.streamSimple(m, ctx, opts),
      initialState: {
        systemPrompt: "You are a test agent.",
        model,
        thinkingLevel: "off",
        tools: [adaptedWithConsent],
        messages: [],
      },
    });
    agent.subscribe((e) => {
      events.push(e);
    });

    await agent.prompt("Please echo hello pi");
    await agent.waitForIdle();

    // The Dyad tool actually ran, through the consent gate.
    expect(record.executed).toBe(true);
    expect(record.receivedText).toBe("hello pi");
    expect(record.consentAsked).toBe(true);

    // The tool's XML output was captured by the adapter seam.
    expect(capturedXml).toBe("<dyad-echo>hello pi</dyad-echo>");

    // A tool result flowed back and the agent produced a final assistant text.
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd).toBeDefined();
    const toolUpdate = events.find((e) => e.type === "tool_execution_update");
    expect(toolUpdate).toMatchObject({
      partialResult: {
        details: { xml: "<dyad-echo>hello pi</dyad-echo>" },
      },
    });

    const finalText = agent.state.messages
      .filter(
        (m): m is Extract<typeof m, { role: "assistant" }> =>
          (m as any).role === "assistant",
      )
      .flatMap((m) => (m as any).content)
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
    expect(finalText).toContain("Done: hello pi");

    // The transcript contains a tool result message for the echo call.
    const toolResult = agent.state.messages.find(
      (m) => (m as any).role === "toolResult",
    );
    expect(toolResult).toBeDefined();
    expect((toolResult as any).content?.[0]?.text).toContain(
      "echoed: hello pi",
    );
  });

  it("blocks the tool when consent is denied", async () => {
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();

    const record = {
      executed: false,
      receivedText: undefined as string | undefined,
      consentAsked: false,
    };

    const echoTool = makeEchoTool(record);
    const adapted = adaptTool(echoTool, {
      contextFactory: () =>
        ({
          requireConsent: async () => {
            record.consentAsked = true;
            return false; // deny
          },
          onXmlComplete: () => {},
          onXmlStream: () => {},
          appendUserMessage: () => {},
          onUpdateTodos: () => {},
          chatId: 1,
          appId: 1,
        }) as unknown as AgentContext,
    });

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("echo", { text: "nope" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("Understood, stopping.")], {
        stopReason: "stop",
      }),
    ]);

    const agent = new Agent({
      streamFn: (m, ctx, opts) => models.streamSimple(m, ctx, opts),
      initialState: {
        systemPrompt: "You are a test agent.",
        model,
        thinkingLevel: "off",
        tools: [adapted],
        messages: [],
      },
    });

    await agent.prompt("Please echo nope");
    await agent.waitForIdle();

    // Consent was asked but the tool body never ran.
    expect(record.consentAsked).toBe(true);
    expect(record.executed).toBe(false);

    // pi records the denial as an error tool result in the transcript.
    const toolResult = agent.state.messages.find(
      (m) => (m as any).role === "toolResult",
    );
    expect(toolResult).toBeDefined();
    expect((toolResult as any).isError).toBe(true);
  });
});
