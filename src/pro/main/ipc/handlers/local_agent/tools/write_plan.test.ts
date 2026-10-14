// @vitest-environment node
import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const calls = vi.hoisted(() => ({ broadcast: vi.fn(), remember: vi.fn() }));
vi.mock("@/ipc/utils/window_broadcast", () => ({
  broadcastToRegisteredWindows: calls.broadcast,
}));
vi.mock("@/ipc/services/plan_handoff_service", () => ({
  rememberPlanDraft: calls.remember,
}));
import { writePlanTool } from "./write_plan";
import { readPlanFromDisk } from "@/ipc/handlers/planPersistence";
import type { AgentContext } from "./types";

it("publishes the durable plan version, including persistence whitespace normalization", async () => {
  const appPath = await mkdtemp(path.join(tmpdir(), "dyad-plan-publish-"));
  const sender = {};
  try {
    await writePlanTool.execute(
      {
        title: "Plan",
        summary: 'Use "lighthouse"',
        plan: "\n## Steps\n\nImplement lighthouse.\n",
      },
      { appPath, chatId: 1, event: { sender } } as AgentContext,
    );
    const plan = await readPlanFromDisk({ appPath, chatId: 1 });
    expect(plan.content).toBe("## Steps\n\nImplement lighthouse.");
    expect(calls.remember).toHaveBeenLastCalledWith(1, plan);
    expect(calls.broadcast).toHaveBeenLastCalledWith(sender, "plan:update", {
      chatId: 1,
      title: plan.title,
      summary: plan.summary,
      plan: plan.content,
    });
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});
