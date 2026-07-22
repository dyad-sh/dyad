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
});
