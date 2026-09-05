/** Opt-in real subscription CLI probe. No account tokens or raw init events
 * are recorded. Bundle with the repository's pinned esbuild (see prototype guide). */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClaudeBridge } from "../src/ipc/services/claude_code/bridge";
import {
  claudeStatus,
  runClaudeTurn,
} from "../src/ipc/services/claude_code/runtime";
import { normalizeClaudeUsage } from "../src/ipc/services/claude_code/usage";

async function main() {
  const cwd = await mkdtemp(path.join(tmpdir(), "dyad-claude-prototype-"));
  const sessionId = randomUUID();
  const status = await claudeStatus();
  if (!status.connected || !status.compatible) throw new Error(status.detail);
  const scenarios: unknown[] = [];
  for (const [index, prompt] of [
    "Remember violet lighthouse. Write hello.txt with exactly hello prototype. Then call the dyad diagnostics MCP tool and report its value. Do not use shell commands.",
    "What phrase did I ask you to remember? Read hello.txt and report it. Do not edit anything.",
    "Create forbidden.txt using Bash or Write. Do not substitute other tools. If unavailable, report that.",
  ].entries()) {
    const controller = new AbortController();
    let approvals = 0;
    let diagnostics = 0;
    let result: Record<string, any> | undefined;
    let deltas = 0;
    const bridge = await createClaudeBridge({
      appPath: cwd,
      readOnly: index > 0,
      signal: controller.signal,
      approve: async () => {
        approvals++;
        return true;
      },
      diagnostics: async () => {
        diagnostics++;
        return { marker: "dyad-preview-healthy" };
      },
      checks: async () => ({}),
      tests: async () => ({}),
      dependencies: async () => ({}),
      restart: async () => ({}),
      onTool: async () => {},
    });
    try {
      await runClaudeTurn({
        cwd,
        prompt,
        model: "sonnet",
        sessionId,
        resume: index > 0,
        readOnly: index > 0,
        signal: controller.signal,
        mcpConfigPath: bridge.configPath,
        onEvent: async (event) => {
          if (event.type === "result") result = event;
          if (event.type === "stream_event") deltas++;
        },
      });
    } finally {
      await bridge.close();
    }
    if (!result || result.is_error) throw new Error(`Scenario ${index} failed`);
    if (
      index === 0 &&
      (!approvals ||
        !diagnostics ||
        (await readFile(path.join(cwd, "hello.txt"), "utf8")).trim() !==
          "hello prototype")
    )
      throw new Error("Edit/permission/MCP assertion failed");
    if (index === 1 && !String(result.result).includes("violet lighthouse"))
      throw new Error("Explicit resume failed");
    if (index === 2) {
      let exists = false;
      try {
        await readFile(path.join(cwd, "forbidden.txt"));
        exists = true;
      } catch {
        /* expected */
      }
      if (exists) throw new Error("Read-only mode allowed a write");
    }
    scenarios.push({
      index,
      approvals,
      diagnostics,
      deltas,
      sessionMatches: result.session_id === sessionId,
      result: result.result,
      usage: normalizeClaudeUsage(result),
    });
    console.log(`Scenario ${index + 1} passed`);
  }
  await writeFile(
    path.join(cwd, "evidence.json"),
    JSON.stringify({ version: status.version, scenarios }, null, 2),
  );
  console.log(`Sanitized evidence: ${path.join(cwd, "evidence.json")}`);
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
