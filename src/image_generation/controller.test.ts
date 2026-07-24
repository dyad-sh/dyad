import { describe, expect, it } from "vitest";
import type { TransitionObserver } from "@/state_machines/types";
import type {
  ImageGenerationCommand,
  ImageGenerationEvent,
  ImageGenerationJobDetails,
  ImageGenerationState,
  ImageGenerationTransitionResult,
} from "./state";
import { ImageGenerationController } from "./controller";
import { transition } from "./transition";

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

interface ImageGenerationTrace {
  outcomes: string[];
  states: ImageGenerationState[];
  commands: ImageGenerationCommand[];
}

class RecordedImageGenerationController {
  private state: ImageGenerationState = { type: "pending", job };
  private readonly pendingEvents: ImageGenerationEvent[] = [];
  private processing = false;

  constructor(
    private readonly runner: {
      run(
        command: ImageGenerationCommand,
        emit: (event: ImageGenerationEvent) => void,
      ): void;
    },
    private readonly observer: TransitionObserver<
      ImageGenerationState,
      ImageGenerationEvent,
      ImageGenerationCommand
    >,
  ) {}

  getSnapshot(): ImageGenerationState {
    return this.state;
  }

  start(): void {
    this.runner.run(
      {
        type: "GenerateImage",
        jobId: job.id,
        params: {
          prompt: job.prompt,
          themeMode: job.themeMode,
          targetAppId: job.targetAppId,
          targetAppName: job.targetAppName,
          source: job.source,
        },
      },
      this.send,
    );
  }

  send = (event: ImageGenerationEvent): void => {
    this.pendingEvents.push(event);
    if (this.processing) return;
    this.processing = true;
    try {
      for (
        let next = this.pendingEvents.shift();
        next !== undefined;
        next = this.pendingEvents.shift()
      ) {
        const previous = this.state;
        const outcome: ImageGenerationTransitionResult = transition(
          previous,
          next,
        );
        if (outcome.kind === "ignored") {
          this.observer.onEventIgnored?.({
            state: previous,
            event: next,
            reason: outcome.reason,
          });
          continue;
        }
        this.observer.onTransitionApplied?.({
          previous,
          event: next,
          state: outcome.state,
          commands: outcome.commands,
        });
        this.state = outcome.state;
        for (const command of outcome.commands) {
          this.runner.run(command, this.send);
        }
      }
    } finally {
      this.processing = false;
    }
  };
}

function recordImageGenerationScenario(
  kind: "reference" | "controller",
): ImageGenerationTrace {
  const trace: ImageGenerationTrace = {
    outcomes: [],
    states: [],
    commands: [],
  };
  let generationEmit: ((event: ImageGenerationEvent) => void) | undefined;
  const observer: TransitionObserver<
    ImageGenerationState,
    ImageGenerationEvent,
    ImageGenerationCommand
  > = {
    onTransitionApplied({ event, state }) {
      trace.outcomes.push(`applied:${event.type}`);
      trace.states.push(state);
    },
    onEventIgnored({ event, state, reason }) {
      trace.outcomes.push(`ignored:${event.type}:${reason}`);
      trace.states.push(state);
    },
  };
  const runner = {
    run(
      command: ImageGenerationCommand,
      emit: (event: ImageGenerationEvent) => void,
    ) {
      trace.commands.push(command);
      if (command.type === "GenerateImage") generationEmit = emit;
      if (command.type === "RequestCancel") {
        emit({ type: "CANCEL_CONFIRMED", cancelled: false });
      }
    },
  };
  const controller =
    kind === "reference"
      ? new RecordedImageGenerationController(runner, observer)
      : new ImageGenerationController(runner, job, observer);

  controller.start();
  controller.send({ type: "CANCEL_REQUESTED" });
  controller.send({ type: "CANCEL_REQUESTED" });
  generationEmit?.({ type: "JOB_SUCCEEDED", result });
  controller.send({
    type: "JOB_FAILED",
    message: "late failure",
    kind: "other",
  });
  trace.states.push(controller.getSnapshot());
  return trace;
}

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

  it("matches the recorded pre-migration event, state, and command trace", () => {
    expect(recordImageGenerationScenario("controller")).toEqual(
      recordImageGenerationScenario("reference"),
    );
  });
});
