import { describe, expect, it, vi } from "vitest";
import { PreviewIframeController } from "./controller";
import type { PreviewIframeCommand } from "./state";

describe("PreviewIframeController", () => {
  it("reports a command failure and remains usable", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let shouldThrow = true;
    const execute = vi.fn((_appId, _command: PreviewIframeCommand) => {
      if (shouldThrow) throw new Error("runner failed");
    });
    const controller = new PreviewIframeController(1, { execute });

    expect(() => controller.send({ type: "IFRAME_LOADED" })).not.toThrow();
    expect(error).toHaveBeenCalledOnce();

    shouldThrow = false;
    controller.send({ type: "NAVIGATE", path: "http://localhost:3000/next" });
    expect(controller.getSnapshot().currentUrl).toBe(
      "http://localhost:3000/next",
    );
    expect(execute).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
