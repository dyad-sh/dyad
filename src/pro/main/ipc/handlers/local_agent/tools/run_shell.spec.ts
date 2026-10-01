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
  deleteHookRemovedFunctions: vi.fn(),
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
    requireConsent: vi.fn(async () => true),
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

it("does not reconcile remote functions after a timeout leaves partial edits", async () => {
  ctx.supabaseProjectId = "project";
  const sleep =
    process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
  const result = JSON.parse(
    await runShellTool.execute(
      {
        command: `${writeCommand}\n${sleep}`,
        description: "Regenerate functions",
        timeout_ms: 200,
      },
      ctx,
    ),
  );
  expect(result.status).toBe("timed_out");
  expect(result.note).toContain("reconciliation was skipped");
  expect(mocks.track).toHaveBeenCalled();
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it("counts executed commands that change state outside Git without claiming file changes", async () => {
  const command =
    process.platform === "win32"
      ? "Set-Content ignored.txt 'changed'"
      : "printf changed > ignored.txt";
  const result = JSON.parse(
    await runShellTool.execute(
      { command, description: "Update generated state" },
      ctx,
    ),
  );
  expect(result.executed).toBe(true);
  expect(mocks.track).toHaveBeenCalledWith(ctx, false);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it("shows the exact command and purpose in consent, and pending progress while running", async () => {
  expect(
    runShellTool.getConsentPreview!({
      command: writeCommand,
      description: "Write test output",
    }),
  ).toContain(writeCommand);
  expect(
    runShellTool.getConsentPreview!({
      command: writeCommand,
      description: "Write test output",
    }),
  ).toContain("Write test output");
  expect(runShellTool.getDescription!({} as AgentContext)).toMatch(
    /^Run an independently reviewed app command/,
  );
  await runShellTool.execute(
    { command: writeCommand, description: "test" },
    ctx,
  );
  expect(ctx.onXmlStream).toHaveBeenCalledWith(
    expect.stringContaining('state="pending"'),
  );
});

it("returns a structured failure when the shell cannot start", async () => {
  ctx.appPath = path.join(directory, "missing-cwd");
  const result = JSON.parse(
    await runShellTool.execute(
      { command: writeCommand, description: "test" },
      ctx,
    ),
  );
  expect(result).toMatchObject({ status: "failed", executed: false });
  expect(result.stderr).toContain("Could not start the shell");
  expect(mocks.track).not.toHaveBeenCalled();
  expect(ctx.onXmlComplete).toHaveBeenCalledWith(
    expect.stringContaining('state="warning"'),
  );
});

it.each([true, false])(
  "requires one-time approval for an ask verdict (approved=%s)",
  async (approved) => {
    mocks.review.mockResolvedValue({
      decision: "ask",
      reason: "Changes the app's cloud service.",
    });
    vi.mocked(ctx.requireConsent).mockResolvedValue(approved);
    const result = JSON.parse(
      await runShellTool.execute(
        { command: writeCommand, description: "test" },
        ctx,
      ),
    );
    expect(ctx.requireConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "run_shell",
        confirmation: "shell-approval",
        inputPreview: expect.stringContaining(writeCommand),
      }),
    );
    expect(result.status).toBe(approved ? "completed" : "cancelled");
    if (!approved) {
      await expect(
        readFile(path.join(directory, "result.txt")),
      ).rejects.toThrow();
      expect(mocks.track).not.toHaveBeenCalled();
    }
  },
);
it("does not offer approval of a policy block", async () => {
  mocks.review.mockResolvedValue({
    decision: "block",
    reason: "Credential theft",
  });
  await runShellTool.execute(
    { command: writeCommand, description: "test" },
    ctx,
  );
  expect(ctx.requireConsent).not.toHaveBeenCalled();
});
it("retries unavailable review before requesting execution consent", async () => {
  mocks.review
    .mockResolvedValueOnce({
      decision: "block",
      reason: "Timed out",
      unavailable: true,
    })
    .mockResolvedValueOnce({ decision: "allow", reason: "Safe bounded write" });
  const result = JSON.parse(
    await runShellTool.execute(
      { command: writeCommand, description: "test" },
      ctx,
    ),
  );
  expect(result.status).toBe("completed");
  expect(mocks.review).toHaveBeenCalledTimes(2);
  expect(ctx.requireConsent).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ confirmation: "shell-review-retry" }),
  );
  expect(ctx.requireConsent).toHaveBeenNthCalledWith(
    2,
    expect.not.objectContaining({ confirmation: "shell-review-retry" }),
  );
});
it("never executes when an unavailable review retry is declined", async () => {
  mocks.review.mockResolvedValue({
    decision: "block",
    reason: "Timed out",
    unavailable: true,
  });
  vi.mocked(ctx.requireConsent).mockResolvedValue(false);
  const result = JSON.parse(
    await runShellTool.execute(
      { command: writeCommand, description: "test" },
      ctx,
    ),
  );
  expect(result).toMatchObject({
    status: "review_unavailable",
    retryable: true,
  });
  await expect(readFile(path.join(directory, "result.txt"))).rejects.toThrow();
});
it("rechecks capability after one-time approval", async () => {
  mocks.review.mockResolvedValue({
    decision: "ask",
    reason: "Consequential action",
  });
  vi.mocked(ctx.requireConsent).mockImplementation(async () => {
    mocks.settings.enableShellTool = false;
    return true;
  });
  const result = JSON.parse(
    await runShellTool.execute(
      { command: writeCommand, description: "test" },
      ctx,
    ),
  );
  expect(result.status).toBe("blocked");
  await expect(readFile(path.join(directory, "result.txt"))).rejects.toThrow();
});

it("cancels while waiting for review retry without executing", async () => {
  const controller = new AbortController();
  ctx.abortSignal = controller.signal;
  mocks.review.mockResolvedValue({
    decision: "block",
    reason: "Timed out",
    unavailable: true,
  });
  vi.mocked(ctx.requireConsent).mockImplementation(async () => {
    controller.abort();
    return false;
  });
  const result = JSON.parse(
    await runShellTool.execute(
      { command: writeCommand, description: "test" },
      ctx,
    ),
  );
  expect(result.status).toBe("cancelled");
  await expect(readFile(path.join(directory, "result.txt"))).rejects.toThrow();
});

import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import {
  createMutationActivityOwner,
  describeTurnActivity,
  endTurnFinalization,
} from "../subagents/mutation_activity_tracker";
import { randomUUID } from "node:crypto";

it.each(["review", "approval", "retry"] as const)(
  "holds no app claims or mutation activity while waiting for %s",
  async (phase) => {
    const turnId = randomUUID();
    ctx.mutationActivityOwner = createMutationActivityOwner({
      appId: ctx.appId,
      chatId: 1,
      turnId,
    });
    const check = async () => {
      expect(describeTurnActivity(turnId)).toBeNull();
      expect(
        appOperationCoordinator.isBusy(ctx.appId, [
          "app-path",
          "repository",
          "runtime",
        ]),
      ).toBe(false);
      await appOperationCoordinator.run(
        {
          appId: ctx.appId,
          operation: "preview-during-consent",
          resources: ["runtime"],
        },
        async () => {},
      );
    };
    if (phase === "review")
      mocks.review.mockImplementation(async () => {
        await check();
        return { decision: "allow", reason: "Safe" };
      });
    else {
      mocks.review.mockResolvedValue(
        phase === "retry"
          ? { decision: "block", reason: "Offline", unavailable: true }
          : { decision: "ask", reason: "Approval needed" },
      );
      vi.mocked(ctx.requireConsent).mockImplementation(async () => {
        await check();
        return false;
      });
    }
    try {
      await runShellTool.execute(
        { command: writeCommand, description: "test" },
        ctx,
      );
    } finally {
      endTurnFinalization(turnId);
    }
  },
);

it("withdraws queued shell admission immediately when cancelled", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const holder = appOperationCoordinator.run(
    { appId: ctx.appId, operation: "hold-repo", resources: ["repository"] },
    async () => {
      entered();
      await gate;
    },
  );
  await ready;
  const controller = new AbortController();
  ctx.abortSignal = controller.signal;
  let approved!: () => void;
  const consent = new Promise<void>((resolve) => {
    approved = resolve;
  });
  vi.mocked(ctx.requireConsent).mockImplementation(async () => {
    approved();
    return true;
  });
  const pending = runShellTool.execute(
    { command: writeCommand, description: "test" },
    ctx,
  );
  const rejected = expect(pending).rejects.toMatchObject({
    kind: "user_cancelled",
  });
  await consent;
  // Let admission enqueue behind the live repository owner.
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  try {
    await rejected;
    await expect(
      readFile(path.join(directory, "result.txt")),
    ).rejects.toThrow();
  } finally {
    release();
    await holder;
  }
});

import * as shellProcess from "./shell_process";
it("returns a recovery error to queued mutations when process shutdown is unconfirmed", async () => {
  const processSpy = vi
    .spyOn(shellProcess, "runShellProcess")
    .mockResolvedValueOnce({
      executed: true,
      code: 0,
      status: "timed_out",
      stdout: "partial",
      stderr: "",
      truncated: false,
      shutdownUnconfirmed: true,
    });
  const block = appOperationCoordinator.blockConflictingOperations.bind(
    appOperationCoordinator,
  );
  let recover: (() => void) | undefined;
  const blockSpy = vi
    .spyOn(appOperationCoordinator, "blockConflictingOperations")
    .mockImplementation((request, reason) => {
      recover = block(request, reason);
      return recover;
    });
  try {
    const result = JSON.parse(
      await runShellTool.execute(
        { command: writeCommand, description: "test" },
        ctx,
      ),
    );
    expect(result.note).toContain("restart Dyad");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    await expect(
      appOperationCoordinator.run(
        {
          appId: ctx.appId,
          operation: "competing-write",
          resources: ["repository"],
        },
        async () => {},
      ),
    ).rejects.toMatchObject({ kind: "precondition" });
  } finally {
    recover?.();
    blockSpy.mockRestore();
    processSpy.mockRestore();
  }
});

it("requires fresh review if inspected files changed during approval", async () => {
  mocks.review.mockResolvedValue({
    decision: "allow",
    reason: "Inspected script",
    revalidateInspection: async () => false,
  });
  const result = JSON.parse(
    await runShellTool.execute(
      { command: writeCommand, description: "test" },
      ctx,
    ),
  );
  expect(result).toMatchObject({
    status: "blocked",
    reason: expect.stringContaining("fresh safety review"),
  });
  expect(mocks.track).not.toHaveBeenCalled();
  await expect(readFile(path.join(directory, "result.txt"))).rejects.toThrow();
});
