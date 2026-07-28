import { describe, expect, it, vi } from "vitest";
import {
  dispatchDueFollowUp,
  type FollowUpDispatchDeps,
} from "./follow_up_dispatch";

function setup(overrides: Partial<FollowUpDispatchDeps> = {}) {
  let due = true;
  const deps: FollowUpDispatchDeps = {
    isStillDue: vi.fn(() => due),
    waitForChatActorIdle: vi.fn(async () => undefined),
    dispatchUserInputFollowUp: vi.fn(async () => "accepted" as const),
    followUpDispatched: vi.fn(async () => {
      due = false;
    }),
    followUpRejected: vi.fn(async () => {
      due = false;
    }),
    ...overrides,
  };
  const command = {
    type: "broadcast-follow-up-due" as const,
    requestId: "request-1",
    chatId: 7,
    prompt: "Continue",
  };
  return { command, deps };
}

describe("dispatchDueFollowUp", () => {
  it.each(["idle wait", "follow-up dispatch"] as const)(
    "rejects a still-due request when %s fails",
    async (failurePoint) => {
      const error = new Error(`${failurePoint} failed`);
      const { command, deps } = setup(
        failurePoint === "idle wait"
          ? { waitForChatActorIdle: vi.fn(async () => Promise.reject(error)) }
          : {
              dispatchUserInputFollowUp: vi.fn(async () =>
                Promise.reject(error),
              ),
            },
      );

      await expect(dispatchDueFollowUp(command, deps)).rejects.toBe(error);
      expect(deps.followUpRejected).toHaveBeenCalledWith("request-1");
    },
  );
});
