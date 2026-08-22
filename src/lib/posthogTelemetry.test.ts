import { describe, expect, it, vi } from "vitest";
import {
  createExceptionFromTelemetry,
  getExceptionTelemetryContext,
  getInitialLoadTelemetryProperties,
  getPostHogTelemetryStorage,
  getSettingsPersonTelemetryProperties,
  isPostHogCrashTelemetryEvent,
  isPostHogErrorTelemetryEvent,
  PostHogErrorDeduper,
  shouldBypassNonProTelemetrySampling,
  shouldFilterPostHogExceptionEvent,
} from "@/lib/posthogTelemetry";
import type { UserSettings } from "@/lib/schemas";

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { provider: "auto", name: "auto" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    ...overrides,
  } as UserSettings;
}

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const HOUR_MS = 60 * 60 * 1000;

function exceptionEvent(
  message = "Failed to load app 123456",
  filename = "file:///Users/alice/dyad/src/example.ts",
  lineno = 42,
  colno = 7,
) {
  return {
    event: "$exception",
    properties: {
      $exception_list: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            type: "raw",
            frames: [
              {
                filename,
                function: "loadApp",
                lineno,
                colno,
              },
            ],
          },
        },
      ],
    },
  };
}

describe("PostHogErrorDeduper", () => {
  it("deduplicates free-user errors for 24 hours", () => {
    const deduper = new PostHogErrorDeduper();
    const event = exceptionEvent();

    expect(deduper.process(event, false, 0)).toBe(event);
    expect(deduper.process(event, false, 23 * HOUR_MS)).toBeNull();
    expect(deduper.process(event, false, 25 * HOUR_MS)).toMatchObject({
      properties: {
        dyad_error_suppressed_count: 1,
        dyad_error_suppression_duration_ms: 25 * HOUR_MS,
      },
    });
  });

  it("deduplicates Pro errors for 10 minutes", () => {
    const deduper = new PostHogErrorDeduper();
    const event = exceptionEvent();

    expect(deduper.process(event, true, 0)).toBe(event);
    expect(deduper.process(event, true, 10 * 60 * 1000 - 1)).toBeNull();
    expect(deduper.process(event, true, 10 * 60 * 1000)).toMatchObject({
      properties: {
        dyad_error_suppressed_count: 1,
        dyad_error_suppression_duration_ms: 10 * 60 * 1000,
      },
    });
  });

  it("reports all suppressed repeats on the next admitted event", () => {
    const deduper = new PostHogErrorDeduper();
    const event = exceptionEvent();

    deduper.process(event, true, 0);
    deduper.process(event, true, 1_000);
    deduper.process(event, true, 2_000);

    expect(deduper.process(event, true, 10 * 60 * 1000)).toMatchObject({
      properties: {
        dyad_error_suppressed_count: 2,
        dyad_error_suppression_duration_ms: 10 * 60 * 1000,
      },
    });
    expect(deduper.process(event, true, 20 * 60 * 1000)).not.toHaveProperty(
      "properties.dyad_error_suppressed_count",
    );
  });

  it("normalizes volatile identifiers and user-specific source prefixes", () => {
    const deduper = new PostHogErrorDeduper();
    const first = exceptionEvent(
      "App 123456 failed for 44d88612-fea8-4a8b-9d71-1cbe1c0187e1",
      "file:///Users/alice/dyad/src/example.ts",
    );
    const repeat = exceptionEvent(
      "App 987654 failed for 550e8400-e29b-41d4-a716-446655440000",
      "file:///home/bob/dyad/src/example.ts",
    );

    expect(deduper.process(first, false, 0)).toBe(first);
    expect(deduper.process(repeat, false, 1)).toBeNull();
  });

  it("normalizes realistic small entity identifiers", () => {
    const deduper = new PostHogErrorDeduper();

    expect(
      deduper.process(exceptionEvent("App 7 not found"), false, 0),
    ).toBeTruthy();
    expect(
      deduper.process(exceptionEvent("App 42 not found"), false, 1),
    ).toBeNull();
    expect(
      deduper.process(exceptionEvent("Chat not found: 3"), false, 2),
    ).toBeTruthy();
    expect(
      deduper.process(exceptionEvent("Chat not found: 18"), false, 3),
    ).toBeNull();
  });

  it("keeps meaningful error codes and throw sites distinct", () => {
    const deduper = new PostHogErrorDeduper();

    expect(
      deduper.process(exceptionEvent("Request failed: 400"), false, 0),
    ).toBeTruthy();
    expect(
      deduper.process(exceptionEvent("Request failed: 500"), false, 1),
    ).toBeTruthy();
    expect(
      deduper.process(
        exceptionEvent("Request failed: 400", "file:///app/src/other.ts"),
        false,
        2,
      ),
    ).toBeTruthy();
    expect(
      deduper.process(
        exceptionEvent(
          "Request failed: 400",
          "file:///app/src/example.ts",
          43,
          7,
        ),
        false,
        3,
      ),
    ).toBeTruthy();
  });

  it("deduplicates custom error-shaped events", () => {
    const deduper = new PostHogErrorDeduper();
    const event = {
      event: "extra-files:error",
      properties: { error: "Git failed for app 123456", appId: 123456 },
    };

    expect(deduper.process(event, false, 0)).toBe(event);
    expect(
      deduper.process(
        {
          event: "extra-files:error",
          properties: { error: "Git failed for app 987654", appId: 987654 },
        },
        false,
        1,
      ),
    ).toBeNull();
  });

  it("keeps stable custom error context distinct", () => {
    const deduper = new PostHogErrorDeduper();
    const iterationError = {
      event: "local_agent:terminated_stream_retry",
      properties: {
        error: "terminated",
        phase: "stream_iteration",
        chatId: 1,
      },
    };
    const finalizationError = {
      event: "local_agent:terminated_stream_retry",
      properties: {
        error: "terminated",
        phase: "response_finalization",
        chatId: 2,
      },
    };

    expect(deduper.process(iterationError, false, 0)).toBe(iterationError);
    expect(deduper.process(finalizationError, false, 1)).toBe(
      finalizationError,
    );
    expect(
      deduper.process(
        {
          ...iterationError,
          properties: { ...iterationError.properties, chatId: 3 },
        },
        false,
        2,
      ),
    ).toBeNull();
  });

  it("always admits explicit crash telemetry", () => {
    const deduper = new PostHogErrorDeduper();
    const crash = {
      event: "renderer:crash_detected",
      properties: { error: true, reason: "crashed" },
    };

    expect(deduper.process(crash, false, 0)).toBe(crash);
    expect(deduper.process(crash, false, 1)).toBe(crash);
  });

  it("shares hashed state without persisting raw telemetry", () => {
    const storage = new MemoryStorage();
    const event = exceptionEvent("uniquely sensitive error 123456");

    expect(new PostHogErrorDeduper(storage).process(event, false, 0)).toBe(
      event,
    );
    expect(
      new PostHogErrorDeduper(storage).process(event, false, 1),
    ).toBeNull();

    const persisted = [...storage.values.values()].join("");
    expect(persisted).not.toContain("uniquely sensitive");
    expect(persisted).not.toContain("example.ts");
    expect(Object.keys(JSON.parse(persisted))).toHaveLength(1);
  });

  it("recovers from malformed or unavailable storage", () => {
    const malformedStorage = new MemoryStorage();
    malformedStorage.setItem("dyadPostHogErrorDedupe:v1", "not-json");
    const event = exceptionEvent();
    const malformedDeduper = new PostHogErrorDeduper(malformedStorage);

    expect(malformedDeduper.process(event, false, 0)).toBe(event);
    expect(malformedDeduper.process(event, false, 1)).toBeNull();

    const throwingStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    const inMemoryDeduper = new PostHogErrorDeduper(throwingStorage);
    expect(inMemoryDeduper.process(event, false, 0)).toBe(event);
    expect(inMemoryDeduper.process(event, false, 1)).toBeNull();
  });

  it("keeps memory authoritative after a storage write failure", () => {
    const readOnlyStorage = {
      getItem: () => "{}",
      setItem: () => {
        throw new Error("storage is read-only");
      },
    };
    const deduper = new PostHogErrorDeduper(readOnlyStorage);
    const event = exceptionEvent();

    expect(deduper.process(event, false, 0)).toBe(event);
    expect(deduper.process(event, false, 1)).toBeNull();
  });

  it("guards access to the localStorage property itself", () => {
    const owner = Object.defineProperty({}, "localStorage", {
      get: () => {
        throw new Error("storage access denied");
      },
    });

    expect(getPostHogTelemetryStorage(owner as Window)).toBeUndefined();
  });

  it("bounds persisted fingerprint records", () => {
    const storage = new MemoryStorage();
    const deduper = new PostHogErrorDeduper(storage);

    for (let index = 0; index < 550; index += 1) {
      deduper.process(exceptionEvent(`Distinct error ${index}`), false, index);
    }

    const persisted = [...storage.values.values()][0];
    expect(Object.keys(JSON.parse(persisted))).toHaveLength(500);
  });

  it("retains a hot suppressed fingerprint when bounding storage", () => {
    const storage = new MemoryStorage();
    const deduper = new PostHogErrorDeduper(storage);
    const hotError = exceptionEvent("Hot recurring error");

    deduper.process(hotError, false, 0);
    for (let index = 1; index < 500; index += 1) {
      deduper.process(exceptionEvent(`Distinct error ${index}`), false, index);
    }
    expect(deduper.process(hotError, false, 500)).toBeNull();
    deduper.process(exceptionEvent("Overflow error one"), false, 501);
    deduper.process(exceptionEvent("Overflow error two"), false, 502);

    expect(deduper.process(hotError, false, 503)).toBeNull();
  });

  it("throttles persistence work for a hot suppressed fingerprint", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const deduper = new PostHogErrorDeduper(storage);
    const event = exceptionEvent();

    deduper.process(event, false, 0);
    const readsAfterAdmission = storage.getItem.mock.calls.length;
    deduper.process(event, false, 1);
    deduper.process(event, false, 2);
    deduper.process(event, false, 3);

    expect(storage.getItem).toHaveBeenCalledTimes(readsAfterAdmission);
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    deduper.process(event, false, 5_000);
    expect(storage.getItem).toHaveBeenCalledTimes(readsAfterAdmission + 1);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it("merges suppression counts from multiple renderer windows", () => {
    const storage = new MemoryStorage();
    const firstWindow = new PostHogErrorDeduper(storage, "window-a");
    const secondWindow = new PostHogErrorDeduper(storage, "window-b");
    const event = exceptionEvent();

    firstWindow.process(event, true, 0);
    secondWindow.process(event, true, 1);
    firstWindow.process(event, true, 2);
    firstWindow.process(event, true, 5_000);
    secondWindow.process(event, true, 5_001);

    const nextWindow = new PostHogErrorDeduper(storage, "window-c");
    expect(nextWindow.process(event, true, 10 * 60 * 1000)).toMatchObject({
      properties: {
        dyad_error_suppressed_count: 4,
      },
    });
  });

  it("merges shared fingerprints before forced writes", () => {
    const storage = new MemoryStorage();
    const firstWindow = new PostHogErrorDeduper(storage, "window-a");
    const secondWindow = new PostHogErrorDeduper(storage, "window-b");

    firstWindow.process(exceptionEvent("Error X"), false, 0);
    secondWindow.process(exceptionEvent("Error Y"), false, 1);
    firstWindow.process(exceptionEvent("Error Z"), false, 2);

    const nextWindow = new PostHogErrorDeduper(storage, "window-c");
    expect(nextWindow.process(exceptionEvent("Error Y"), false, 3)).toBeNull();
  });

  it("refreshes shared state before admitting at the dedupe boundary", () => {
    const storage = new MemoryStorage();
    const firstWindow = new PostHogErrorDeduper(storage, "window-a");
    const secondWindow = new PostHogErrorDeduper(storage, "window-b");
    const event = exceptionEvent();
    const proWindowMs = 10 * 60 * 1000;

    firstWindow.process(event, true, 0);
    firstWindow.process(event, true, proWindowMs - 1);
    expect(secondWindow.process(event, true, proWindowMs)).toBeTruthy();
    expect(firstWindow.process(event, true, proWindowMs + 1)).toBeNull();
  });

  it("honors forced shared reads within the same millisecond", () => {
    const storage = new MemoryStorage();
    const firstWindow = new PostHogErrorDeduper(storage, "window-a");
    const secondWindow = new PostHogErrorDeduper(storage, "window-b");

    firstWindow.process(exceptionEvent("Error X"), false, 0);
    secondWindow.process(exceptionEvent("Error Y"), false, 0);

    expect(firstWindow.process(exceptionEvent("Error Y"), false, 0)).toBeNull();
  });
});

describe("PostHog error telemetry classification", () => {
  it("recognizes exception and custom error shapes", () => {
    expect(isPostHogErrorTelemetryEvent(exceptionEvent())).toBe(true);
    expect(
      isPostHogErrorTelemetryEvent({
        event: "custom-event",
        properties: { $exception_type: "TypeError" },
      }),
    ).toBe(true);
    expect(
      isPostHogErrorTelemetryEvent({
        event: "custom-event",
        properties: { error: true },
      }),
    ).toBe(true);
    expect(
      isPostHogErrorTelemetryEvent({
        event: "custom-event",
        properties: { error: false },
      }),
    ).toBe(false);
    expect(isPostHogErrorTelemetryEvent({ event: "chat:submit" })).toBe(false);
  });

  it("recognizes all current explicit crash event names", () => {
    for (const event of [
      "app:crash_detected",
      "renderer:crash_detected",
      "utility_process:crash_detected",
      "code_explorer:host_crash",
    ]) {
      expect(isPostHogCrashTelemetryEvent({ event })).toBe(true);
    }
    expect(isPostHogCrashTelemetryEvent(exceptionEvent())).toBe(false);
  });
});

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
          selectedChatMode: "build",
          runtimeMode2: "docker",
          providerSettings: {
            auto: { apiKey: { value: "secret" } },
          },
          enableAppBlueprint: false,
          enableTestingForNewApps: true,
        }),
        appVersion: "1.1.0",
        platform: "darwin",
        isFirstSession: false,
      }),
    ).toEqual({
      isPro: true,
      appVersion: "1.1.0",
      platform: "darwin",
      releaseChannel: "beta",
      isFirstSession: false,
      enableAppBlueprint: false,
      enableTestingForNewApps: true,
      modelProvider: "auto",
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
      isPro: false,
      appVersion: "1.1.0",
      platform: null,
      releaseChannel: "stable",
      isFirstSession: true,
      enableAppBlueprint: true,
      enableTestingForNewApps: false,
      modelProvider: "auto",
      defaultChatMode: null,
      runtimeMode2: "host",
    });
  });
});

describe("getSettingsPersonTelemetryProperties", () => {
  it("includes pro and settings toggles for PostHog people properties", () => {
    expect(
      getSettingsPersonTelemetryProperties(
        makeSettings({
          providerSettings: {
            auto: { apiKey: { value: "secret" } },
          },
          enableAppBlueprint: false,
          enableTestingForNewApps: true,
        }),
      ),
    ).toEqual({
      isPro: true,
      enableAppBlueprint: false,
      enableTestingForNewApps: true,
    });
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

  it("always sends the screenshot prompt funnel for non-Pro sampling", () => {
    for (const event of [
      "screenshot-prompt:shown",
      "screenshot-prompt:capture-attempt",
      "screenshot-prompt:captured",
      "screenshot-prompt:capture-abandoned",
      "screenshot-prompt:capture-failed",
      "screenshot-prompt:decline",
      "screenshot-prompt:dismissed",
      "session-report:copy-session-id",
    ]) {
      expect(
        shouldBypassNonProTelemetrySampling({
          event,
          properties: { source: "upload-session" },
        }),
      ).toBe(true);
    }
  });

  it("always sends app:initial-load for non-Pro sampling", () => {
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "app:initial-load",
        properties: { isPro: false, appVersion: "1.0.0" },
      }),
    ).toBe(true);
  });

  it("always sends PostHog person-property updates for non-Pro sampling", () => {
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "$set",
        properties: {
          $set: { enableTestingForNewApps: true },
        },
      }),
    ).toBe(true);
  });

  it("always sends promo_click for non-Pro sampling", () => {
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "promo_click",
        properties: { messageId: "pro-trial" },
      }),
    ).toBe(true);
  });

  it("always sends pnpm build policy telemetry for non-Pro sampling", () => {
    expect(
      shouldBypassNonProTelemetrySampling({
        event: "pnpm:build-auto-denied",
        properties: { packages: ["core-js@3.49.0"] },
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
