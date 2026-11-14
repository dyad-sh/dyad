// @vitest-environment node
// Real Claude Code CLI smoke tests for the native harness. They spend
// subscription usage, so they only run with DYAD_REAL_CLAUDE_SMOKE=1, outside
// the sandbox, on a machine signed in with `claude auth login`. They load the
// user's real Claude Code setup, exactly like a native Dyad turn does.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createDyadToolBridge } from "./tool_bridge";
import {
  runClaudeTurn,
  type CliControlRequest,
  type CliEvent,
} from "./runtime";
import {
  NATIVE_TOOL_ALLOWLIST,
  validateNativeInventory,
} from "./native/tool_policy";

const live = process.env.DYAD_REAL_CLAUDE_SMOKE === "1";
const model = process.env.DYAD_REAL_CLAUDE_MODEL ?? "haiku";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function nativeTurn(prompt: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "dyad-native-live-"));
  directories.push(directory);
  execFileSync("git", ["init", "-q"], { cwd: directory });
  await writeFile(path.join(directory, "system.txt"), "You are testing Dyad.");
  const abort = new AbortController();
  const dyadCalls: string[] = [];
  const bridge = await createDyadToolBridge({
    tools: {
      restart_app: {
        description: "Restart the app preview.",
        inputSchema: z.object({}),
      },
    },
    signal: abort.signal,
    invoke: async (name) => {
      dyadCalls.push(name);
      return { content: [{ type: "text", text: "Restarted" }] };
    },
  });
  const events: CliEvent[] = [];
  const requests: CliControlRequest[] = [];
  let inventoryProblem: string | undefined = "no init event";
  try {
    await runClaudeTurn({
      cwd: directory,
      prompt,
      model,
      sessionId: randomUUID(),
      resume: false,
      signal: abort.signal,
      mcpConfigPath: bridge.configPath,
      dyadTools: bridge.names,
      maxTurns: 10,
      native: {
        tools: [...NATIVE_TOOL_ALLOWLIST],
        permissionMode: "auto",
        appendSystemPromptPath: path.join(directory, "system.txt"),
        hooks: {
          PreToolUse: ["dyad-pre-tool"],
          PostToolUse: ["dyad-post-tool"],
        },
      },
      onEvent: async (event) => {
        events.push(event);
        if (event.type === "system" && event.subtype === "init")
          inventoryProblem = validateNativeInventory(
            event.tools,
            event.mcp_servers,
            bridge.names,
          );
      },
      onControlRequest: async (request) => {
        requests.push(request);
        return request.subtype === "can_use_tool"
          ? { behavior: "allow", updatedInput: request.input }
          : {};
      },
    });
  } finally {
    await bridge.close();
  }
  return { directory, events, requests, dyadCalls, inventoryProblem };
}

const hooksFor = (requests: CliControlRequest[], tool: string) =>
  requests
    .filter((r) => r.subtype === "hook_callback")
    .filter((r) => (r.input as { tool_name?: string })?.tool_name === tool)
    .map((r) => r.callback_id);

it.skipIf(!live)(
  "runs native Bash with Dyad's hooks and still reaches Dyad's MCP tools",
  async () => {
    const { directory, requests, dyadCalls, inventoryProblem, events } =
      await nativeTurn(
        "Use the Bash tool to run exactly: echo native > native.txt\nThen call the mcp__dyad__restart_app tool once. Then reply with the single word done.",
      );
    expect(inventoryProblem).toBeUndefined();
    expect(
      (await readFile(path.join(directory, "native.txt"), "utf8")).trim(),
    ).toBe("native");
    expect(hooksFor(requests, "Bash")).toEqual(
      expect.arrayContaining(["dyad-pre-tool", "dyad-post-tool"]),
    );
    expect(dyadCalls).toEqual(["restart_app"]);
    expect(events.at(-1)?.type).toBe("result");
  },
  180_000,
);

// pgrep is POSIX; Windows cleanup is covered by runtime_native.test.ts.
it.skipIf(!live || process.platform === "win32")(
  "stops background Bash tasks when the native turn ends",
  async () => {
    const marker = `${Math.floor(Math.random() * 1e6) + 1e6}`;
    const started = Date.now();
    await nativeTurn(
      `Use the Bash tool with run_in_background set to true to run exactly: sleep ${marker}\nDo not wait for it. Then reply with the single word done.`,
    );
    // Without Dyad stopping it, the CLI would wait on the background task.
    expect(Date.now() - started).toBeLessThan(150_000);
    const running = (() => {
      try {
        return execFileSync("pgrep", ["-f", `sleep ${marker}`], {
          encoding: "utf8",
        }).trim();
      } catch {
        return "";
      }
    })();
    expect(running).toBe("");
  },
  180_000,
);
