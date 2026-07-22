import { describe, expect, it } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import type { ImageGenerationEvent } from "./state";
import { ImageGenerationManager } from "./manager";

const result = {
  fileName: "generated.png",
  filePath: "/tmp/generated.png",
  appPath: "app",
  appId: 1,
  appName: "App",
};

describe("ImageGenerationManager", () => {
  it("mints job IDs and projects controller state", () => {
    const clock = createFakeClock(1_000);
    const manager = new ImageGenerationManager({
      clock,
      idSource: createSequentialIdSource(),
      runner: {
        run(command, emit) {
          if (command.type === "GenerateImage") {
            emit({ type: "JOB_SUCCEEDED", result });
          }
        },
      },
    });

    const id = manager.submit({
      prompt: "A lighthouse",
      themeMode: "plain",
      targetAppId: 1,
      targetAppName: "App",
      source: "chat",
    });

    expect(id).toBe("image-generation:1");
    expect(manager.getProjection()).toEqual([
      expect.objectContaining({
        id,
        startedAt: 1_000,
        status: "success",
        result,
      }),
    ]);
  });

  it("projects cancellation requests separately from pending work", () => {
    let emitJob: ((event: ImageGenerationEvent) => void) | undefined;
    const manager = new ImageGenerationManager({
      clock: createFakeClock(),
      idSource: createSequentialIdSource(),
      runner: {
        run(command, emit) {
          if (command.type === "GenerateImage") emitJob = emit;
        },
      },
    });
    const id = manager.submit({
      prompt: "A lighthouse",
      themeMode: "plain",
      targetAppId: 1,
      targetAppName: "App",
      source: "chat",
    });

    manager.cancel(id);

    expect(manager.getProjection()).toEqual([
      expect.objectContaining({ id, status: "cancelling" }),
    ]);

    emitJob?.({ type: "JOB_SUCCEEDED", result });
    expect(manager.getProjection()).toEqual([
      expect.objectContaining({
        id,
        status: "success",
        lateAfterCancel: true,
      }),
    ]);
  });

  it("prunes terminal controllers older than 30 minutes on submit", () => {
    const clock = createFakeClock();
    let emitFirst: ((event: ImageGenerationEvent) => void) | undefined;
    const manager = new ImageGenerationManager({
      clock,
      idSource: createSequentialIdSource(),
      runner: {
        run(command, emit) {
          if (command.type === "GenerateImage" && !emitFirst) emitFirst = emit;
        },
      },
    });
    const first = manager.submit({
      prompt: "First",
      themeMode: "plain",
      targetAppId: 1,
      targetAppName: "App",
    });
    emitFirst?.({ type: "JOB_SUCCEEDED", result });
    clock.advanceBy(30 * 60 * 1000 + 1);

    const second = manager.submit({
      prompt: "Second",
      themeMode: "plain",
      targetAppId: 1,
      targetAppName: "App",
    });

    expect(manager.getState(first)).toBeUndefined();
    expect(manager.getProjection().map((job) => job.id)).toEqual([second]);
  });
});
