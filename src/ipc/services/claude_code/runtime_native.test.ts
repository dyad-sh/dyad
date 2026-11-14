// @vitest-environment node
// Real child processes (no spawn mocks): this must pass on Windows CI too,
// where Dyad stops the CLI's process tree with taskkill instead of a signal
// to its process group.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claudeArguments,
  runClaudeTurn,
  type CliControlRequest,
  type CliEvent,
} from "./runtime";

const fakeCli = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "testing",
  "fake_native_cli.mjs",
);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

const native = {
  tools: ["Read", "Write", "Edit", "Bash"],
  permissionMode: "auto" as const,
  appendSystemPromptPath: "/prompt.txt",
  hooks: { PreToolUse: ["pre"], PostToolUse: ["post"] },
};

describe("native Claude Code turns", () => {
  it("builds terminal-like arguments with an explicit tool list", () => {
    const args = claudeArguments({
      cwd: "/app",
      prompt: "untrusted prompt",
      model: "sonnet",
      sessionId: "session",
      resume: true,
      resumeAt: "uuid-2",
      freshSystemPrompt: true,
      mcpConfigPath: "/mcp.json",
      native,
    });
    expect(args).not.toContain("--restricted");
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--disable-slash-commands");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Write,Edit,Bash");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("auto");
    expect(args[args.indexOf("--permission-prompt-tool") + 1]).toBe("stdio");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe(
      "user,project,local",
    );
    expect(args[args.indexOf("--append-system-prompt-file") + 1]).toBe(
      "/prompt.txt",
    );
    expect(args[args.indexOf("--resume-session-at") + 1]).toBe("uuid-2");
    expect(args).toContain("--fork-session");
    expect(args[args.indexOf("--system-prompt-snapshot") + 1]).toBe("off");
    expect(args).not.toContain("untrusted prompt");
  });

  it("never forks a session that is not being resumed", () => {
    const args = claudeArguments({
      cwd: "/app",
      prompt: "p",
      model: "sonnet",
      sessionId: "new",
      resume: false,
      resumeAt: "uuid-2",
      mcpConfigPath: "/mcp.json",
      native,
    });
    expect(args).not.toContain("--resume-session-at");
    expect(args).not.toContain("--fork-session");
  });

  it("answers control requests and stops the CLI and its background work after the result", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dyad-native-cli-"));
    directories.push(directory);
    const pidFile = path.join(directory, "background.pid");
    const events: CliEvent[] = [];
    const requests: CliControlRequest[] = [];
    const started = Date.now();
    await runClaudeTurn({
      cwd: directory,
      prompt: "start a watcher",
      model: "sonnet",
      sessionId: "session-1",
      resume: false,
      signal: new AbortController().signal,
      mcpConfigPath: path.join(directory, "mcp.json"),
      native,
      command: {
        executable: process.execPath,
        args: [fakeCli, "--fake-pid-file", pidFile],
      },
      onEvent: async (event) => {
        events.push(event);
      },
      onControlRequest: async (request) => {
        requests.push(request);
        return request.subtype === "can_use_tool"
          ? { behavior: "allow", updatedInput: request.input }
          : {};
      },
    });
    // The fake never exits on its own; Dyad must stop it shortly after the
    // result instead of waiting for the background task.
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(requests.map((r) => r.subtype)).toEqual([
      "can_use_tool",
      "hook_callback",
      "hook_callback",
    ]);
    expect(
      requests
        .filter((r) => r.subtype === "hook_callback")
        .map((r) => r.callback_id),
    ).toEqual(["pre", "post"]);
    const toolResult = events.find((e) => e.type === "user");
    expect(JSON.stringify(toolResult)).toContain("permission: allow");
    expect(events.some((e) => e.type === "result")).toBe(true);
    // Control traffic is handled by the runtime, not forwarded as events.
    expect(events.some((e) => e.type === "control_request")).toBe(false);
    const backgroundPid = Number(await readFile(pidFile, "utf8"));
    await vi.waitFor(() => expect(isAlive(backgroundPid)).toBe(false), {
      timeout: 10_000,
      interval: 100,
    });
  }, 30_000);

  it("returns an error response when a control handler fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dyad-native-cli-"));
    directories.push(directory);
    const events: CliEvent[] = [];
    await runClaudeTurn({
      cwd: directory,
      prompt: "start a watcher",
      model: "sonnet",
      sessionId: "session-2",
      resume: false,
      signal: new AbortController().signal,
      mcpConfigPath: path.join(directory, "mcp.json"),
      native,
      command: { executable: process.execPath, args: [fakeCli] },
      onEvent: async (event) => {
        events.push(event);
      },
      onControlRequest: async (request) => {
        if (request.subtype === "can_use_tool")
          throw new Error("approval failed");
        return {};
      },
    });
    // The fake reports what it received; an error response has no behavior.
    expect(JSON.stringify(events.find((e) => e.type === "user"))).toContain(
      "permission: none",
    );
  }, 30_000);
});
