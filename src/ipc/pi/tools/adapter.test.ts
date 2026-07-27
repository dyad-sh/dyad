// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

// tool_invocation.ts (imported transitively by the adapter) reads settings for
// per-tool consent defaults. Stub readSettings so consent resolves purely from
// the injected ctx.requireConsent, keeping the adapter under test.
vi.mock("@/main/settings", () => ({
  readSettings: () => ({ agentToolConsents: {} }),
  writeSettings: () => {},
}));

vi.mock("@/ipc/handlers/app_blueprint_handlers", () => ({
  getAppBlueprintForChat: () => undefined,
}));

import { adaptTool, zodToTypebox, type AgentContextFactory } from "./adapter";
import type { AgentContext, ToolDefinition } from "./dyad/types";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";

/**
 * Minimal AgentContext stub. Only the fields the adapter path touches are
 * populated; the rest are cast away because the adapter never reads them.
 */
function makeContextFactory(opts: {
  consent: boolean;
  onXmlSink?: (xml: string) => void;
}): AgentContextFactory {
  return ({ onXml }) => {
    const ctx = {
      requireConsent: async () => opts.consent,
      onXmlComplete: (xml: string) => {
        onXml(xml);
        opts.onXmlSink?.(xml);
      },
      onXmlStream: (xml: string) => onXml(xml),
      appendUserMessage: () => {},
    } as unknown as AgentContext;
    return ctx;
  };
}

const echoSchema = z.object({
  message: z.string().min(1).describe("text to echo"),
  count: z.number().int().min(1).max(5).optional(),
});

function makeEchoTool(
  execute: ToolDefinition<z.infer<typeof echoSchema>>["execute"],
): ToolDefinition<z.infer<typeof echoSchema>> {
  return {
    name: "echo",
    description: "Echo the message",
    inputSchema: echoSchema,
    defaultConsent: "ask",
    execute,
  };
}

describe("zodToTypebox", () => {
  it("emits a JSON-Schema object with properties and drops $schema", () => {
    const schema = zodToTypebox(echoSchema) as unknown as Record<
      string,
      unknown
    >;
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("$schema");
    expect(schema.properties).toHaveProperty("message");
    expect(schema.properties).toHaveProperty("count");
  });
});

describe("adaptTool", () => {
  it("carries name/description/label from the ToolDefinition", () => {
    const tool = adaptTool(
      makeEchoTool(async () => "ok"),
      { contextFactory: makeContextFactory({ consent: true }) },
    );
    expect(tool.name).toBe("echo");
    expect(tool.label).toBe("echo");
    expect(tool.description).toBe("Echo the message");
  });

  it("executes the wrapped tool and returns its text as pi content", async () => {
    const tool = adaptTool(
      makeEchoTool(async (args) => `echoed:${args.message}`),
      { contextFactory: makeContextFactory({ consent: true }) },
    );
    const result = await tool.execute("call-1", { message: "hi" });
    expect(result.content).toEqual([{ type: "text", text: "echoed:hi" }]);
    expect(result.details.toolName).toBe("echo");
  });

  it("captures onXmlComplete output into details.xml", async () => {
    const tool = adaptTool(
      makeEchoTool(async (_args, ctx) => {
        ctx.onXmlComplete("<dyad-echo>hi</dyad-echo>");
        return "done";
      }),
      { contextFactory: makeContextFactory({ consent: true }) },
    );
    const result = await tool.execute("call-2", { message: "hi" });
    expect(result.details.xml).toBe("<dyad-echo>hi</dyad-echo>");
  });

  it("uses buildXml for tools whose execute method does not emit XML", async () => {
    const definition = makeEchoTool(async () => "done");
    definition.buildXml = (args, isComplete) =>
      `<dyad-echo>${args.message ?? ""}${isComplete ? "</dyad-echo>" : ""}`;
    const tool = adaptTool(definition, {
      contextFactory: makeContextFactory({ consent: true }),
    });

    const result = await tool.execute("call-xml", { message: "hi" });

    expect(result.details.xml).toBe("<dyad-echo>hi</dyad-echo>");
  });

  it("forwards initial and streamed XML through pi tool updates", async () => {
    const definition = makeEchoTool(async (_args, ctx) => {
      ctx.onXmlStream("<dyad-echo>running");
      return "done";
    });
    definition.buildXml = (args, isComplete) =>
      `<dyad-echo>${args.message ?? ""}${isComplete ? "</dyad-echo>" : ""}`;
    const tool = adaptTool(definition, {
      contextFactory: makeContextFactory({ consent: true }),
    });
    const onUpdate = vi.fn();

    await tool.execute("call-stream", { message: "hi" }, undefined, onUpdate);

    expect(onUpdate).toHaveBeenNthCalledWith(1, {
      content: [],
      details: {
        toolName: "echo",
        xml: "<dyad-echo>hi",
        appendedUserMessages: [],
      },
    });
    expect(onUpdate).toHaveBeenNthCalledWith(2, {
      content: [],
      details: {
        toolName: "echo",
        xml: "<dyad-echo>running",
        appendedUserMessages: [],
      },
    });
  });

  it("enforces the app-blueprint gate before a mutating tool executes", async () => {
    const execute = vi.fn(async () => "written");
    const definition: ToolDefinition<{ path: string }> = {
      name: "write_file",
      description: "write",
      inputSchema: z.object({ path: z.string() }),
      defaultConsent: "always",
      modifiesState: true,
      execute,
    };
    const tool = adaptTool(definition, {
      contextFactory: () =>
        ({
          chatId: 42,
          enableAppBlueprint: true,
          requireConsent: async () => true,
          onXmlComplete: () => {},
          onXmlStream: () => {},
          appendUserMessage: () => {},
        }) as unknown as AgentContext,
    });

    await expect(
      tool.execute("call-blueprint", { path: "src/App.tsx" }),
    ).rejects.toSatisfy(
      (error) =>
        isDyadError(error) && error.kind === DyadErrorKind.Precondition,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("tracks file-edit attempts and successful mutations", async () => {
    const context = {
      chatId: 42,
      enableAppBlueprint: false,
      fileEditTracker: {},
      mutationCount: 0,
      requireConsent: async () => true,
      onXmlComplete: () => {},
      onXmlStream: () => {},
      appendUserMessage: () => {},
    } as unknown as AgentContext;
    const definition: ToolDefinition<{ path: string }> = {
      name: "write_file",
      description: "write",
      inputSchema: z.object({ path: z.string() }),
      defaultConsent: "always",
      modifiesState: true,
      execute: async () => "written",
    };
    const tool = adaptTool(definition, {
      contextFactory: () => context,
    });

    await tool.execute("call-track", { path: "src/App.tsx" });

    expect(context.fileEditTracker).toEqual({
      "src/App.tsx": { write_file: 1 },
    });
    expect(context.mutationCount).toBe(1);
  });

  it("expands Neon client placeholders before consent and execution", async () => {
    const execute = vi.fn(async () => "written");
    const definition: ToolDefinition<{ content: string }> = {
      name: "write_file",
      description: "write",
      inputSchema: z.object({ content: z.string() }),
      defaultConsent: "always",
      modifiesState: true,
      execute,
    };
    const context = {
      chatId: 42,
      enableAppBlueprint: false,
      neonProjectId: null,
      fileEditTracker: {},
      requireConsent: async () => true,
      onXmlComplete: () => {},
      onXmlStream: () => {},
      appendUserMessage: () => {},
    } as unknown as AgentContext;
    const tool = adaptTool(definition, { contextFactory: () => context });

    await tool.execute("call-placeholder", {
      content: "before $$NEON_CLIENT_CODE$$ after",
    });

    expect(execute).toHaveBeenCalledWith({ content: "before  after" }, context);
  });

  it("throws UserCancelled when consent is denied and does not run execute", async () => {
    const run = vi.fn(async () => "should not run");
    const tool = adaptTool(makeEchoTool(run), {
      contextFactory: makeContextFactory({ consent: false }),
    });
    await expect(tool.execute("call-3", { message: "hi" })).rejects.toSatisfy(
      (e) => isDyadError(e) && e.kind === DyadErrorKind.UserCancelled,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("reports escaped renderer XML when the wrapped tool throws", async () => {
    const onToolErrorXml = vi.fn();
    const tool = adaptTool(
      makeEchoTool(async () => {
        throw new Error('bad <detail> & "quoted"');
      }),
      {
        contextFactory: makeContextFactory({ consent: true }),
        onToolErrorXml,
      },
    );

    await expect(tool.execute("call-error", { message: "hi" })).rejects.toThrow(
      'bad <detail> & "quoted"',
    );
    expect(onToolErrorXml).toHaveBeenCalledWith(
      "call-error",
      '<dyad-output type="error" message="Tool \'echo\' failed: bad &lt;detail&gt; &amp; &quot;quoted&quot;">bad &lt;detail&gt; &amp; "quoted"</dyad-output>',
    );
  });

  it("rejects arguments that violate zod refinements the JSON-Schema dropped", async () => {
    const run = vi.fn(async () => "ran");
    const tool = adaptTool(makeEchoTool(run), {
      contextFactory: makeContextFactory({ consent: true }),
    });
    // count = 99 violates .max(5); empty message violates .min(1)
    await expect(
      tool.execute("call-4", { message: "hi", count: 99 }),
    ).rejects.toSatisfy(
      (e) => isDyadError(e) && e.kind === DyadErrorKind.Validation,
    );
    expect(run).not.toHaveBeenCalled();
  });
});
