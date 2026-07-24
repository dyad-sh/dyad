import { describe, expect, it } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import type { TransitionObserver } from "@/state_machines/types";
import type {
  VoiceCommand,
  VoiceEvent,
  VoiceState,
  VoiceTransitionResult,
} from "./state";
import { VoiceToTextController } from "./controller";
import { transition } from "./transition";

interface VoiceTrace {
  outcomes: string[];
  states: VoiceState[];
  commands: VoiceCommand[];
}

class RecordedReferenceController {
  private state: VoiceState = { type: "idle" };
  private readonly events: VoiceEvent[] = [];
  private processing = false;

  constructor(
    private readonly runner: {
      run(command: VoiceCommand, emit: (event: VoiceEvent) => void): void;
    },
    private readonly observer: TransitionObserver<
      VoiceState,
      VoiceEvent,
      VoiceCommand
    >,
  ) {}

  getSnapshot(): VoiceState {
    return this.state;
  }

  send = (event: VoiceEvent): void => {
    this.events.push(event);
    if (this.processing) return;
    this.processing = true;
    try {
      for (
        let next = this.events.shift();
        next !== undefined;
        next = this.events.shift()
      ) {
        const previous = this.state;
        const result: VoiceTransitionResult = transition(previous, next);
        if (result.kind === "ignored") {
          this.observer.onEventIgnored?.({
            state: previous,
            event: next,
            reason: result.reason,
          });
          continue;
        }
        this.observer.onTransitionApplied?.({
          previous,
          event: next,
          state: result.state,
          commands: result.commands,
        });
        this.state = result.state;
        for (const command of result.commands) {
          this.runner.run(command, this.send);
        }
      }
    } finally {
      this.processing = false;
    }
  };
}

function recordVoiceScenario(kind: "reference" | "dispatcher"): VoiceTrace {
  const trace: VoiceTrace = { outcomes: [], states: [], commands: [] };
  const observer: TransitionObserver<VoiceState, VoiceEvent, VoiceCommand> = {
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
    run(command: VoiceCommand, emit: (event: VoiceEvent) => void) {
      trace.commands.push(command);
      if (command.type === "AcquireMedia") {
        emit({ type: "MEDIA_ACQUIRED", attempt: command.attempt });
      }
    },
  };
  const controller =
    kind === "reference"
      ? new RecordedReferenceController(runner, observer)
      : new VoiceToTextController({
          idSource: createSequentialIdSource(),
          runner,
          observer,
        });

  controller.send({ type: "TOGGLE", attempt: "voice-attempt:1" });
  controller.send({ type: "TOGGLE", attempt: "voice-attempt:2" });
  controller.send({
    type: "RECORDER_STOPPED",
    attempt: "voice-attempt:1",
    hasAudio: true,
  });
  controller.send({
    type: "TRANSCRIPTION_OK",
    attempt: "voice-attempt:1",
    text: "  transcript  ",
  });
  controller.send({
    type: "MEDIA_DENIED",
    attempt: "stale-attempt",
    message: "late",
  });
  trace.states.push(controller.getSnapshot());
  return trace;
}

describe("VoiceToTextController", () => {
  it("allocates attempts and applies synchronous command events serially", () => {
    const commands: VoiceCommand[] = [];
    const controller = new VoiceToTextController({
      idSource: createSequentialIdSource(),
      runner: {
        run(command, emit) {
          commands.push(command);
          if (command.type === "AcquireMedia") {
            emit({ type: "MEDIA_ACQUIRED", attempt: command.attempt });
          }
        },
      },
    });

    controller.toggle();

    expect(controller.getSnapshot()).toEqual({
      type: "recording",
      attempt: "voice-attempt:1",
    });
    expect(commands.map((command) => command.type)).toEqual([
      "AcquireMedia",
      "StartRecorder",
      "ScheduleDurationLimit",
    ]);
  });

  it("runs teardown commands once and discards late events", () => {
    const commands: VoiceCommand[] = [];
    let lateEmit: ((event: VoiceEvent) => void) | undefined;
    const controller = new VoiceToTextController({
      idSource: createSequentialIdSource(),
      runner: {
        run(command, emit) {
          commands.push(command);
          if (command.type === "AcquireMedia") lateEmit = emit;
          if (command.type === "StopRecorder") {
            lateEmit?.({
              type: "RECORDER_STOPPED",
              attempt: command.attempt,
              hasAudio: true,
            });
          }
        },
      },
    });
    controller.toggle();

    controller.dispose();
    controller.dispose();
    lateEmit?.({ type: "MEDIA_ACQUIRED", attempt: "voice-attempt:1" });

    expect(commands.slice(1)).toEqual([
      { type: "CancelDurationLimit", attempt: "voice-attempt:1" },
      {
        type: "StopRecorder",
        attempt: "voice-attempt:1",
        reason: null,
      },
      { type: "ReleaseMedia", attempt: "voice-attempt:1" },
    ]);
    expect(controller.getSnapshot()).toEqual({
      type: "acquiring",
      attempt: "voice-attempt:1",
    });
  });

  it("stops a recording when the injected fake clock reaches the limit", () => {
    const clock = createFakeClock();
    const commands: VoiceCommand[] = [];
    const controller = new VoiceToTextController({
      idSource: createSequentialIdSource(),
      runner: {
        run(command, emit) {
          commands.push(command);
          if (command.type === "AcquireMedia") {
            emit({ type: "MEDIA_ACQUIRED", attempt: command.attempt });
          } else if (command.type === "ScheduleDurationLimit") {
            clock.schedule(
              () =>
                emit({
                  type: "DURATION_ELAPSED",
                  attempt: command.attempt,
                }),
              30,
            );
          }
        },
      },
    });
    controller.toggle();

    clock.advanceBy(30);

    expect(controller.getSnapshot()).toEqual({
      type: "stopping",
      attempt: "voice-attempt:1",
      reason: "duration",
    });
    expect(commands).toContainEqual({
      type: "StopRecorder",
      attempt: "voice-attempt:1",
      reason: "duration",
    });
  });

  it("commits after lease-cleanup failure and rejects the stale timer event", () => {
    const failures: string[] = [];
    const ignored: string[] = [];
    const controller = new VoiceToTextController({
      idSource: createSequentialIdSource(),
      runner: {
        run(command, emit) {
          if (command.type === "AcquireMedia") {
            emit({ type: "MEDIA_ACQUIRED", attempt: command.attempt });
          }
        },
        beforeStateCommit(previous, next) {
          if (previous.type === "recording" && next.type === "stopping") {
            throw new Error("lease cleanup failed");
          }
        },
      },
      observer: {
        onEventIgnored({ event, reason }) {
          ignored.push(`${event.type}:${reason}`);
        },
      },
      reportError: (error) => failures.push(error.stage),
    });
    controller.toggle();

    controller.toggle();
    controller.send({
      type: "DURATION_ELAPSED",
      attempt: "voice-attempt:1",
    });

    expect(controller.getSnapshot()).toEqual({
      type: "stopping",
      attempt: "voice-attempt:1",
      reason: "user",
    });
    expect(failures).toEqual(["before-commit"]);
    expect(ignored).toEqual(["DURATION_ELAPSED:stale-attempt"]);
  });

  it("matches the recorded pre-migration event, state, and command trace", () => {
    expect(recordVoiceScenario("dispatcher")).toEqual(
      recordVoiceScenario("reference"),
    );
  });
});
