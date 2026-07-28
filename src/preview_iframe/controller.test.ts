import { describe, expect, it, vi } from "vitest";
import { PreviewIframeController } from "./controller";
import type { PreviewIframeCommand } from "./state";

describe("PreviewIframeController", () => {
  it("commits readiness before a restore completion re-enters", () => {
    const commands: PreviewIframeCommand[] = [];
    const controller = new PreviewIframeController(1, {
      execute(_appId, command, emit) {
        commands.push(command);
        if (
          command.type === "post-to-iframe" &&
          command.message.type === "restore-overlays"
        ) {
          expect(controller.getSnapshot().selectorReady).toBe(true);
          expect(controller.getSnapshot().restoreQueued).toBe(true);
          emit({ type: "SELECTION_RESTORED" });
        }
      },
    });
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.send({ type: "SELECTION_RESTORE_QUEUED" });
    controller.send({ type: "SELECTOR_READY" });

    expect(commands).toEqual([
      { type: "post-to-iframe", message: { type: "restore-overlays" } },
    ]);
    expect(controller.getSnapshot().restoreQueued).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("notifies and continues when a command runner throws", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let throwOnCleanup = false;
    const execute = vi.fn((_appId, command: PreviewIframeCommand) => {
      if (
        throwOnCleanup &&
        command.type === "post-to-iframe" &&
        command.message.type === "cleanup-all-text-editing"
      ) {
        throw new Error("runner failed");
      }
    });
    const controller = new PreviewIframeController(1, { execute });
    controller.send({ type: "APP_URL_CHANGED", url: "http://localhost:3000" });
    controller.send({ type: "SELECTOR_READY" });
    controller.send({ type: "PICKER_TOGGLED" });
    execute.mockClear();
    const listener = vi.fn();
    controller.subscribe(listener);
    throwOnCleanup = true;

    expect(() => controller.send({ type: "PICKER_TOGGLED" })).not.toThrow();

    expect(controller.getSnapshot().picking).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledOnce();

    throwOnCleanup = false;
    controller.send({ type: "PICKER_TOGGLED" });
    expect(controller.getSnapshot().picking).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
