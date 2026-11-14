import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserInputRegistry } from "@/user_input/registry";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { userInputContracts } from "@/ipc/types/user_input";
import {
  ENABLE_TESTING_FOLLOW_UP_PROMPT,
  DECLINE_TESTING_FOLLOW_UP_PROMPT,
} from "@/user_input/transition";
import type { AgentContext } from "./types";
import { enableTestingTool } from "./enable_testing";

const mock = vi.hoisted(() => ({
  registry: null as unknown as ReturnType<typeof createUserInputRegistry>,
}));
vi.mock("@/user_input/main", () => ({
  get userInputRegistry() {
    return mock.registry;
  },
}));

describe("enable_testing", () => {
  const clock = createFakeClock();
  beforeEach(() => {
    mock.registry = createUserInputRegistry({
      clock,
      idSource: createSequentialIdSource(),
      broadcast: vi.fn(),
    });
  });
  afterEach(() => mock.registry.dispose());

  function context() {
    const controller = new AbortController();
    const onXmlComplete = vi.fn();
    const ctx = {
      appId: 3,
      chatId: 7,
      testingEnabled: false,
      abortSignal: controller.signal,
      onXmlComplete,
    } as unknown as AgentContext;
    return { ctx, controller, onXmlComplete };
  }

  it.each([true, false])(
    "parks until the user chooses enabled=%s, then schedules one continuation",
    async (enabled) => {
      const { ctx, onXmlComplete } = context();
      const settled = vi.fn();
      const execution = enableTestingTool.execute({}, ctx).then((result) => {
        settled();
        return result;
      });
      const [pending] = mock.registry.getPending();
      expect(pending.descriptor).toMatchObject({
        kind: "enable-testing",
        appId: 3,
        chatId: 7,
      });
      expect(onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining(
          `request-id="${pending.descriptor.requestId}" outcome="pending"`,
        ),
      );
      clock.advanceBy(7 * 24 * 60 * 60 * 1_000);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(() =>
        userInputContracts.getPending.output.parse(mock.registry.getPending()),
      ).not.toThrow();
      await mock.registry.respond(pending.descriptor.requestId, {
        kind: "enable-testing",
        enabled,
      });
      expect(await execution).toContain(
        enabled ? "user enabled" : "user declined",
      );
      expect(onXmlComplete).toHaveBeenLastCalledWith(
        expect.stringContaining(
          `outcome="${enabled ? "enabled" : "declined"}"`,
        ),
      );
      expect(mock.registry.getPending()[0]).toMatchObject({
        status: "armed",
        followUpPrompt: enabled
          ? ENABLE_TESTING_FOLLOW_UP_PROMPT
          : DECLINE_TESTING_FOLLOW_UP_PROMPT,
      });
      mock.registry.streamFinished(7);
      expect(mock.registry.getPending()[0].status).toBe("due");
      await mock.registry.followUpDispatched(pending.descriptor.requestId);
      expect(mock.registry.getPending()).toEqual([]);
    },
  );

  it("cancels the card and rejects late approval without a follow-up", async () => {
    const { ctx, controller, onXmlComplete } = context();
    const execution = enableTestingTool.execute({}, ctx);
    const requestId = mock.registry.getPending()[0].descriptor.requestId;
    controller.abort();
    expect(await execution).toContain("cancelled");
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      expect.stringContaining('outcome="dismissed"'),
    );
    await expect(
      mock.registry.respond(requestId, {
        kind: "enable-testing",
        enabled: true,
      }),
    ).rejects.toThrow("No pending");
    expect(mock.registry.getPending()).toEqual([]);
  });

  it("does not create a second card for a concurrent call with a copied context", async () => {
    const { ctx, controller } = context();
    const first = enableTestingTool.execute({}, ctx);
    expect(await enableTestingTool.execute({}, { ...ctx })).toContain(
      "already been offered",
    );
    expect(mock.registry.getPending()).toHaveLength(1);
    controller.abort();
    await first;
  });
});
