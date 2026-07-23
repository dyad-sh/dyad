import { describe, expect, it } from "vitest";
import { createRecordingCommandRunner } from "@/state_machines/testing";
import type { GithubOpsCommandRunner } from "./commands";
import { GithubOpsController } from "./controller";
import type { GithubOpsCommand, GithubOpsEvent } from "./state";

function controllerWithRunner(
  implementation: (
    command: GithubOpsCommand,
    emit: (event: GithubOpsEvent) => void,
  ) => void,
) {
  const recording = createRecordingCommandRunner(implementation);
  const runner = {
    run(
      _appId: number,
      command: GithubOpsCommand,
      emit: (event: GithubOpsEvent) => void,
    ) {
      void recording.run(command, emit);
    },
  } as GithubOpsCommandRunner;
  return { controller: new GithubOpsController(7, runner), recording };
}

describe("GithubOpsController", () => {
  it("clears a successful push banner when history-changing work starts", () => {
    const { controller } = controllerWithRunner((command, emit) => {
      if (command.type === "run-op" && command.op.type === "push") {
        emit({ type: "OP_SUCCEEDED", op: command.op });
      }
    });

    controller.send({
      type: "OP_REQUESTED",
      op: { type: "push", mode: "normal" },
    });
    expect(controller.getSnapshot().banner?.kind).toBe("success");

    controller.send({ type: "OP_REQUESTED", op: { type: "pull" } });
    expect(controller.getSnapshot()).toMatchObject({
      type: "running",
      op: { type: "pull" },
      banner: null,
    });
  });

  it("removes conflict UI in the same snapshot that starts abort-and-switch", () => {
    const { controller, recording } = controllerWithRunner((command, emit) => {
      if (command.type === "run-op" && command.op.type === "switch") {
        emit({
          type: "OP_FAILED",
          op: command.op,
          failure: {
            code: "MERGE_IN_PROGRESS",
            kind: "conflict",
            message: "merge in progress",
          },
        });
      }
      if (command.type === "probe-conflicts") {
        emit({ type: "CONFLICTS", files: ["src/conflicted.ts"] });
      }
    });

    controller.send({
      type: "OP_REQUESTED",
      op: { type: "switch", branch: "feature" },
    });
    expect(controller.getSnapshot()).toMatchObject({
      type: "switch-blocked",
      hasConflicts: true,
    });

    controller.send({ type: "ABORT_AND_SWITCH_CONFIRMED" });
    expect(controller.getSnapshot()).toMatchObject({
      type: "running",
      op: { type: "merge-abort" },
      next: { type: "switch", branch: "feature" },
    });
    expect(controller.getSnapshot()).not.toHaveProperty("files");
    expect(recording.commands.at(-1)).toEqual({
      type: "run-op",
      op: { type: "merge-abort" },
    });
  });
});
