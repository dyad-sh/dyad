import { expect, it } from "vitest";
import { z } from "zod";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDyadToolBridge } from "./tool_bridge";
import { runClaudeTurn } from "./runtime";

it.skipIf(process.env.DYAD_REAL_CLAUDE_SMOKE !== "1")(
  "live CLI has no native operations and invokes only the host tool",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dyad-cli-tools-"));
    const abort = new AbortController();
    const invocations: unknown[] = [];
    const tools = {
      write_fixture: {
        description: "Write the isolated fixture text",
        inputSchema: z.object({ text: z.string() }),
      },
    };
    const bridge = await createDyadToolBridge({
      tools,
      signal: abort.signal,
      invoke: async (_name, args) => {
        const parsed = tools.write_fixture.inputSchema.parse(args);
        invocations.push(parsed);
        await writeFile(path.join(directory, "fixture.txt"), parsed.text);
        return { content: [{ type: "text", text: "Saved" }] };
      },
    });
    const events: Record<string, any>[] = [];
    try {
      await runClaudeTurn({
        cwd: directory,
        prompt:
          'Use mcp__dyad__write_fixture to write exactly "fixture-ready", then reply done.',
        model: "sonnet",
        sessionId: randomUUID(),
        resume: false,

        signal: abort.signal,
        mcpConfigPath: bridge.configPath,
        dyadTools: bridge.names,
        onEvent: async (event) => {
          events.push(event);
        },
      });
      const startup = events.find(
        (event) => event.type === "system" && event.subtype === "init",
      );
      expect(
        startup?.tools
          .filter((name: string) => name !== "EndConversation")
          .sort(),
      ).toEqual([...bridge.names].sort());
      expect(startup?.mcp_servers).toMatchObject([
        { name: "dyad", status: "connected" },
      ]);
      expect(invocations).toEqual([{ text: "fixture-ready" }]);
      expect(await readFile(path.join(directory, "fixture.txt"), "utf8")).toBe(
        "fixture-ready",
      );
      expect(events.find((event) => event.type === "result")?.is_error).toBe(
        false,
      );
    } finally {
      abort.abort();
      await bridge.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);

it.skipIf(process.env.DYAD_REAL_CLAUDE_SMOKE !== "1")(
  "live CLI keeps a human-decision MCP call pending beyond its default request timeout",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dyad-cli-wait-"));
    const abort = new AbortController();
    let invocations = 0;
    const bridge = await createDyadToolBridge({
      tools: {
        wait_for_answer: {
          description: "Wait for the user's answer",
          inputSchema: z.object({}),
        },
      },
      signal: abort.signal,
      invoke: async () => {
        invocations++;
        await new Promise((resolve) => setTimeout(resolve, 65_000));
        return {
          content: [
            {
              type: "text",
              text: "The user's recorded answer is violet lighthouse.",
            },
          ],
        };
      },
    });
    let result: any;
    try {
      await runClaudeTurn({
        cwd: directory,
        prompt:
          "Call wait_for_answer exactly once and wait for its result. Then repeat the user's answer.",
        model: "sonnet",
        sessionId: randomUUID(),
        resume: false,

        signal: abort.signal,
        mcpConfigPath: bridge.configPath,
        dyadTools: bridge.names,
        onEvent: async (event) => {
          if (event.type === "result") result = event;
        },
      });
      expect(invocations).toBe(1);
      expect(result?.is_error).toBe(false);
      expect(result?.result).toMatch(/violet lighthouse/i);
    } finally {
      abort.abort();
      await bridge.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);

it.skipIf(process.env.DYAD_REAL_CLAUDE_SMOKE !== "1")(
  "workflow interruption flushes authoritative usage without another tool invocation",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dyad-cli-interrupt-"));
    const abort = new AbortController();
    const watchdog = setTimeout(() => abort.abort(), 90_000);
    let calls = 0;
    const bridge = await createDyadToolBridge({
      tools: {
        write_plan: {
          description: "Save a plan and stop for human review",
          inputSchema: z.object({}),
        },
      },
      signal: abort.signal,
      invoke: async () => {
        calls++;
        return {
          content: [
            { type: "text", text: "Plan saved; wait for user review." },
          ],
        };
      },
    });
    let result: Record<string, any> | undefined;
    try {
      await runClaudeTurn({
        cwd: directory,
        prompt:
          "Call write_plan once now to save the plan. Do not use any other tool.",
        model: "sonnet",
        sessionId: randomUUID(),
        resume: false,

        signal: abort.signal,
        mcpConfigPath: bridge.configPath,
        dyadTools: bridge.names,
        onEvent: async (event) => {
          if (event.type === "result") result = event;
          if (event.type === "user" && calls) return "interrupt";
        },
      });
      expect(calls).toBe(1);
      expect(result?.modelUsage).toBeDefined();
      expect(Object.keys(result!.modelUsage).length).toBeGreaterThan(0);
      expect(result?.num_turns).toBeGreaterThan(0);
    } finally {
      clearTimeout(watchdog);
      abort.abort();
      await bridge.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
