import { describe, expect, it } from "vitest";

import type { HandoffCommandRunner } from "./controller";
import { createPlanHandoffRegistry } from "./registry";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("plan handoff controller registry", () => {
  it("disposes one chat without affecting another in-flight handoff", async () => {
    const gates = new Map([
      [1, deferred()],
      [2, deferred()],
    ]);
    const executed: string[] = [];
    const run: HandoffCommandRunner = async (command) => {
      if (command.type === "mark-plan-accepted") {
        await gates.get(command.chatId)?.promise;
      }
      executed.push(
        "chatId" in command
          ? `${command.chatId}:${command.type}`
          : command.type,
      );
    };
    const registry = createPlanHandoffRegistry(run);

    for (const chatId of [1, 2]) {
      registry.getOrCreate(chatId).send({
        type: "PLAN_ACCEPTED",
        chatId,
        appId: 10,
        acceptInNewChat: true,
      });
    }
    await flush();

    registry.dispose(1);
    gates.get(1)?.resolve();
    gates.get(2)?.resolve();
    await flush();

    expect(registry.getState(1)).toEqual({ type: "idle" });
    expect(registry.getState(2).type).toBe("cancelling-stream");
    expect(executed).toContain("1:mark-plan-accepted");
    expect(executed).not.toContain("1:cancel-stream");
    expect(executed).toContain("2:mark-plan-accepted");
    expect(executed).toContain("2:cancel-stream");

    registry.dispose(2);
  });
});
