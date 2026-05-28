import { describe, expect, it } from "vitest";
import {
  createExceptionFromTelemetry,
  getExceptionTelemetryContext,
  shouldBypassNonProTelemetrySampling,
  shouldFilterPostHogExceptionEvent,
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

describe("shouldFilterPostHogExceptionEvent", () => {
  it("filters generic TypeError fetch failed from main-process telemetry", () => {
    expect(
      shouldFilterPostHogExceptionEvent({
        event: "$exception",
        properties: {
          exception_name: "TypeError",
          exception_message: "fetch failed",
        },
      }),
    ).toBe(true);
  });

  it("filters generic TypeError fetch failed from PostHog autocapture", () => {
    expect(
      shouldFilterPostHogExceptionEvent({
        event: "$exception",
        properties: {
          $exception_type: "TypeError",
          $exception_message: "fetch failed",
        },
      }),
    ).toBe(true);
  });

  it("does not filter fetch failures with actionable messages", () => {
    expect(
      shouldFilterPostHogExceptionEvent({
        event: "$exception",
        properties: {
          exception_name: "TypeError",
          exception_message: "fetch failed: ECONNREFUSED",
        },
      }),
    ).toBe(false);
  });
});

describe("shouldBypassNonProTelemetrySampling", () => {
  it("always sends sandbox.script.* events for non-Pro sampling", () => {
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "sandbox.script.completed",
        properties: { chatId: 1, appId: 2 },
      }),
    ).toBe(true);
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "sandbox.script.truncated",
        properties: { chatId: 1 },
      }),
    ).toBe(true);
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "sandbox.script.failed",
        properties: { error: "Unexpected token" },
      }),
    ).toBe(true);
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "sandbox.script.timeout",
        properties: { error: "Script timed out" },
      }),
    ).toBe(true);
  });

  it("does not bypass unrelated sandbox telemetry", () => {
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "sandbox.tool.unused_with_attachment",
        properties: { chatId: 1 },
      }),
    ).toBe(false);
  });

  it("still bypasses sampling for error-shaped events", () => {
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "$exception",
        properties: { exception_message: "boom" },
      }),
    ).toBe(true);
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "extra-files:error",
        properties: {},
      }),
    ).toBe(true);
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "app:crash_detected",
        properties: { error: true },
      }),
    ).toBe(true);
  });

  it("allows routine events to be sampled", () => {
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "chat:submit",
        properties: { chatMode: "build" },
      }),
    ).toBe(false);
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
