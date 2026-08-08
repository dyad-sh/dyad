import { describe, expect, it } from "vitest";
import {
  createExceptionFromTelemetry,
  getExceptionTelemetryContext,
} from "@/lib/posthogTelemetry";

describe("createExceptionFromTelemetry", () => {
  it("uses exception telemetry fields when present", () => {
    const error = createExceptionFromTelemetry({
      exception_name: "TypeError",
      exception_message: "Boom",
      exception_stack_trace: "TypeError: Boom\n at ipc-handler",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TypeError");
    expect(error.message).toBe("Boom");
    expect(error.stack).toBe("TypeError: Boom\n at ipc-handler");
  });

  it("falls back to a default message when telemetry is incomplete", () => {
    const error = createExceptionFromTelemetry(undefined);

    expect(error.name).toBe("Error");
    expect(error.message).toBe("Unknown IPC exception");
  });
});

describe("getExceptionTelemetryContext", () => {
  it("removes exception payload fields before passing custom context to PostHog", () => {
    expect(
      getExceptionTelemetryContext({
        exception_name: "TypeError",
        exception_message: "Boom",
        exception_stack_trace: "TypeError: Boom\n at ipc-handler",
        ipc_channel: "window:minimize",
      }),
    ).toEqual({
      ipc_channel: "window:minimize",
    });
  });

  it("returns undefined when there is no custom context", () => {
    expect(
      getExceptionTelemetryContext({
        exception_name: "TypeError",
        exception_message: "Boom",
      }),
    ).toBeUndefined();
  });
});
