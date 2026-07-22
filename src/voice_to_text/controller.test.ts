import { describe, expect, it } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import type { VoiceCommand, VoiceEvent } from "./state";
import { VoiceToTextController } from "./controller";

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
          lateEmit = emit;
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
});
