import { describe, expect, it } from "vitest";
import type {
  ImageGenerationCommand,
  ImageGenerationEvent,
  ImageGenerationJobDetails,
} from "./state";
import { ImageGenerationController } from "./controller";

const job: ImageGenerationJobDetails = {
  id: "job:1",
  prompt: "A lighthouse",
  themeMode: "plain",
  targetAppId: 1,
  targetAppName: "App",
  startedAt: 100,
};
const result = {
  fileName: "generated.png",
  filePath: "/tmp/generated.png",
  appPath: "app",
  appId: 1,
  appName: "App",
};

describe("ImageGenerationController", () => {
  it("keeps a failed best-effort cancel pending until a late success arrives", () => {
    const commands: ImageGenerationCommand[] = [];
    let generationEmit: ((event: ImageGenerationEvent) => void) | undefined;
    const controller = new ImageGenerationController(
      {
        run(command, emit) {
          commands.push(command);
          if (command.type === "GenerateImage") generationEmit = emit;
          if (command.type === "RequestCancel") {
            emit({ type: "CANCEL_CONFIRMED", cancelled: false });
          }
        },
      },
      job,
    );

    controller.start();
    controller.send({ type: "CANCEL_REQUESTED" });
    expect(controller.getSnapshot().type).toBe("cancelling");

    generationEmit?.({ type: "JOB_SUCCEEDED", result });

    expect(controller.getSnapshot()).toEqual({
      type: "succeeded",
      job,
      result,
      lateAfterCancel: true,
    });
    expect(commands.at(-1)).toEqual({ type: "InvalidateMediaQueries" });
  });

  it("settles cancellation only when generation rejects as user-cancelled", () => {
    let generationEmit: ((event: ImageGenerationEvent) => void) | undefined;
    const controller = new ImageGenerationController(
      {
        run(command, emit) {
          if (command.type === "GenerateImage") generationEmit = emit;
          if (command.type === "RequestCancel") {
            emit({ type: "CANCEL_CONFIRMED", cancelled: true });
          }
        },
      },
      job,
    );

    controller.start();
    controller.send({ type: "CANCEL_REQUESTED" });
    expect(controller.getSnapshot().type).toBe("cancelling");

    generationEmit?.({
      type: "JOB_FAILED",
      message: "cancelled",
      kind: "user_cancelled",
    });
    expect(controller.getSnapshot().type).toBe("cancelled");
  });

  it("discards async completions after disposal", () => {
    const commands: ImageGenerationCommand[] = [];
    let generationEmit: ((event: ImageGenerationEvent) => void) | undefined;
    const controller = new ImageGenerationController(
      {
        run(command, emit) {
          commands.push(command);
          if (command.type === "GenerateImage") generationEmit = emit;
        },
      },
      job,
    );
    controller.start();
    controller.dispose();

    generationEmit?.({ type: "JOB_SUCCEEDED", result });

    expect(controller.getSnapshot().type).toBe("pending");
    expect(commands.at(-1)).toEqual({
      type: "RequestCancel",
      jobId: job.id,
    });
  });
});
