import { describe, expect, it } from "vitest";
import {
  createExceptionFromTelemetry,
  getExceptionTelemetryContext,
  getInitialLoadTelemetryProperties,
  shouldBypassTelemetrySampling,
  shouldFilterPostHogExceptionEvent,
} from "@/lib/posthogTelemetry";
import type { UserSettings } from "@/lib/schemas";

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { provider: "openrouter", name: "test-model" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    ...overrides,
  } as UserSettings;
}

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

describe("getInitialLoadTelemetryProperties", () => {
  it("includes high-value launch properties from settings", () => {
    expect(
      getInitialLoadTelemetryProperties({
        settings: makeSettings({
          releaseChannel: "beta",
          defaultChatMode: "ask",
          selectedChatMode: "local-agent",
          runtimeMode2: "docker",
          providerSettings: {
            openrouter: { apiKey: { value: "secret" } },
          },
        }),
        appVersion: "1.1.0",
        platform: "darwin",
        isFirstSession: false,
      }),
    ).toEqual({
      appVersion: "1.1.0",
      platform: "darwin",
      releaseChannel: "beta",
      isFirstSession: false,
      modelProvider: "openrouter",
      defaultChatMode: "ask",
      runtimeMode2: "docker",
    });
  });

  it("marks first sessions and leaves unset default chat mode as null", () => {
    expect(
      getInitialLoadTelemetryProperties({
        settings: makeSettings({
          selectedChatMode: "plan",
        }),
        appVersion: "1.1.0",
        platform: null,
        isFirstSession: true,
      }),
    ).toEqual({
      appVersion: "1.1.0",
      platform: null,
      releaseChannel: "stable",
      isFirstSession: true,
      modelProvider: "openrouter",
      defaultChatMode: null,
      runtimeMode2: "host",
    });
  });
});

describe("shouldBypassTelemetrySampling", () => {
  it("always sends app:initial-load", () => {
    expect(
      shouldBypassTelemetrySampling({
        event: "app:initial-load",
        properties: { appVersion: "1.0.0" },
      }),
    ).toBe(true);
  });

  it("always sends pnpm build policy telemetry", () => {
    expect(
      shouldBypassTelemetrySampling({
        event: "pnpm:build-auto-denied",
        properties: { packages: ["core-js@3.49.0"] },
      }),
    ).toBe(true);
  });

  it("still bypasses sampling for error-shaped events", () => {
    expect(
      shouldBypassTelemetrySampling({
        event: "$exception",
        properties: { exception_message: "boom" },
      }),
    ).toBe(true);
    expect(
      shouldBypassTelemetrySampling({
        event: "extra-files:error",
        properties: {},
      }),
    ).toBe(true);
    expect(
      shouldBypassTelemetrySampling({
        event: "app:crash_detected",
        properties: { error: true },
      }),
    ).toBe(true);
  });

  it("allows routine events to be sampled", () => {
    expect(
      shouldBypassTelemetrySampling({
        event: "chat:submit",
        properties: { chatMode: "local-agent" },
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
