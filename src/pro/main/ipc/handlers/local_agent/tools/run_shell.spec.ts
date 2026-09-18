import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";
const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  reconcile: vi.fn(),
  track: vi.fn(),
  settings: {
    enableShellTool: true,
    enableDyadPro: true,
    providerSettings: { auto: { apiKey: { value: "test" } } },
    agentToolConsents: { run_shell: "always" },
  },
}));
vi.mock("@/main/settings", () => ({ readSettings: () => mocks.settings }));
vi.mock("../shell_review", () => ({ reviewShellCommand: mocks.review }));
vi.mock("@/ipc/utils/process_manager", () => ({ runningApps: new Map() }));
vi.mock("./tool_invocation", () => ({ trackWorkspaceMutation: mocks.track }));
vi.mock("./run_pre_commit", () => ({
  tryGetGitStateFingerprint: async (dir: string) =>
    readFile(path.join(dir, "result.txt"), "utf8").catch(() => "absent"),
  tryCollectSupabaseFunctionEntryPoints: vi.fn(),
  scheduleHookGeneratedFileSideEffects: mocks.reconcile,
}));
import { runShellTool } from "./run_shell";
let directory: string;
let ctx: AgentContext;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.settings.enableShellTool = true;
  directory = await mkdtemp(path.join(os.tmpdir(), "dyad-shell-tool-"));
  ctx = {
    appId: 81234,
    appPath: directory,
    isDyadPro: true,
    shellReviewContext: { tools: [], history: [] },
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    preCommitHookAvailable: true,
  } as unknown as AgentContext;
  mocks.review.mockResolvedValue({
    decision: "allow",
    reason: "Permitted test command",
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const writeCommand =
  process.platform === "win32"
    ? "Set-Content result.txt 'done'"
    : "printf done > result.txt";
describe("reviewed shell execution", () => {
  it("blocks despite saved always consent and never writes", async () => {
    mocks.review.mockResolvedValue({
      decision: "block",
      reason: "Use write_file",
    });
    const result = JSON.parse(
      await runShellTool.execute(
        { command: writeCommand, description: "test" },
        ctx,
      ),
    );
    expect(result).toEqual({ status: "blocked", reason: "Use write_file" });
    await expect(
      readFile(path.join(directory, "result.txt")),
    ).rejects.toThrow();
    expect(mocks.track).not.toHaveBeenCalled();
  });
  it("executes approved commands and reconciles file changes", async () => {
    const result = JSON.parse(
      await runShellTool.execute(
        { command: writeCommand, description: "test" },
        ctx,
      ),
    );
    expect(result.status).toBe("completed");
    expect(
      await readFile(path.join(directory, "result.txt"), "utf8"),
    ).toContain("done");
    expect(mocks.track).toHaveBeenCalledWith(ctx, true);
    expect(mocks.reconcile).toHaveBeenCalled();
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining("Permitted test command"),
    );
  });
  it("retains and accounts for edits even when the process fails", async () => {
    const result = JSON.parse(
      await runShellTool.execute(
        { command: `${writeCommand}\nexit 9`, description: "test" },
        ctx,
      ),
    );
    expect(result.status).toBe("failed");
    expect(result.note).toContain("Partial changes may remain");
    expect(mocks.track).toHaveBeenCalled();
  });
  it("does not spawn after cancellation during review", async () => {
    const controller = new AbortController();
    ctx.abortSignal = controller.signal;
    mocks.review.mockImplementation(async () => {
      controller.abort();
      return { decision: "allow", reason: "safe" };
    });
    const result = JSON.parse(
      await runShellTool.execute(
        { command: writeCommand, description: "test" },
        ctx,
      ),
    );
    expect(result.status).toBe("cancelled");
    await expect(
      readFile(path.join(directory, "result.txt")),
    ).rejects.toThrow();
  });
  it("rechecks the setting after review", async () => {
    mocks.review.mockImplementation(async () => {
      mocks.settings.enableShellTool = false;
      return { decision: "allow", reason: "safe" };
    });
    const result = JSON.parse(
      await runShellTool.execute(
        { command: writeCommand, description: "test" },
        ctx,
      ),
    );
    expect(result.status).toBe("blocked");
    await expect(
      readFile(path.join(directory, "result.txt")),
    ).rejects.toThrow();
  });
});
