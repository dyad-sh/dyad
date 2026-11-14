// Fake Claude Code CLI for native-harness runtime tests. Speaks the subset of
// the stream-json protocol Dyad uses: initialize (hook registration),
// can_use_tool, hook_callback, tool events and result. Like the real CLI with
// a background Bash task, it does NOT exit after its result; it also starts a
// long-running child process, whose pid it writes to the --fake-pid-file path (Dyad strips the CLI's
// environment, so tests cannot pass it as a variable), so the
// test can check that Dyad's process cleanup reaches grandchildren too.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const sessionId = flag("--session-id") ?? flag("--resume") ?? randomUUID();
const tools = (flag("--tools") ?? "").split(",").filter(Boolean);
const write = (event) => process.stdout.write(JSON.stringify(event) + "\n");

const pending = new Map();
const request = (body) =>
  new Promise((resolve) => {
    const id = randomUUID();
    pending.set(id, resolve);
    write({ type: "control_request", request_id: id, request: body });
  });

let hooks = {};
let started = false;
// Keep the process alive like a CLI waiting on a background task.
setInterval(() => {}, 1_000);

async function runTurn() {
  write({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    tools: [...tools, "mcp__dyad__restart_app"],
    mcp_servers: [{ name: "dyad", status: "connected" }],
  });
  const background = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  const pidFile = flag("--fake-pid-file");
  if (pidFile) writeFileSync(pidFile, String(background.pid));
  const input = { command: "sleep 600", run_in_background: true };
  write({
    type: "assistant",
    uuid: randomUUID(),
    parent_tool_use_id: null,
    message: {
      model: "fake-model",
      content: [{ type: "tool_use", id: "tool-1", name: "Bash", input }],
    },
  });
  const permission = await request({
    subtype: "can_use_tool",
    tool_name: "Bash",
    input,
  });
  for (const id of hooks.PreToolUse ?? [])
    await request({
      subtype: "hook_callback",
      callback_id: id,
      input: {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: input,
      },
    });
  for (const id of hooks.PostToolUse ?? [])
    await request({
      subtype: "hook_callback",
      callback_id: id,
      input: {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: input,
      },
    });
  write({
    type: "user",
    parent_tool_use_id: null,
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: `permission: ${permission?.response?.behavior ?? "none"}`,
        },
      ],
    },
  });
  write({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { delta: { type: "text_delta", text: "started" } },
  });
  write({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 2,
    result: "started",
    modelUsage: {},
  });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const event = JSON.parse(line);
  if (
    event.type === "control_request" &&
    event.request?.subtype === "initialize"
  ) {
    for (const [name, matchers] of Object.entries(event.request.hooks ?? {}))
      hooks[name] = matchers.flatMap(
        (matcher) => matcher.hookCallbackIds ?? [],
      );
    write({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: event.request_id,
        response: {},
      },
    });
    return;
  }
  if (event.type === "control_response") {
    pending.get(event.response?.request_id)?.(event.response);
    pending.delete(event.response?.request_id);
    return;
  }
  if (event.type === "user" && !started) {
    started = true;
    void runTurn();
  }
});
