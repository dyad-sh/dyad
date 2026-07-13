import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { forkMock, sendTelemetryEventMock } = vi.hoisted(() => ({
  forkMock: vi.fn(),
  sendTelemetryEventMock: vi.fn(),
}));

vi.mock("electron", () => ({
  utilityProcess: {
    fork: (...args: unknown[]) => forkMock(...args),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/paths/paths", () => ({
  getTypeScriptCachePath: () => "/tmp/code-explorer-test-cache",
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: (...args: unknown[]) => sendTelemetryEventMock(...args),
}));

import { runCodeExplorer } from "./code_explorer";

interface FakeUtilityProcess extends EventEmitter {
  postMessage: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}

describe("code explorer host telemetry", () => {
  let child: FakeUtilityProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    child = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      kill: vi.fn(() => true),
    });
    forkMock.mockReturnValue(child);
  });

  it("reports a fatal V8 host crash without including the diagnostic report", async () => {
    const request = runCodeExplorer({
      appPath: "/tmp/example-app",
      query: "find the entry point",
    });

    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit("spawn");
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledOnce());

    child.emit(
      "error",
      "FatalError",
      "CALL_AND_RETRY_LAST",
      "sensitive diagnostic report",
    );
    child.emit("exit", 0);

    await expect(request).rejects.toThrow(
      "Code explorer host exited with code 0 before replying",
    );
    expect(child.kill).toHaveBeenCalledOnce();
    expect(sendTelemetryEventMock).toHaveBeenCalledOnce();
    expect(sendTelemetryEventMock).toHaveBeenCalledWith(
      "code_explorer:host_crash",
      {
        error: true,
        generation: 1,
        reason: "v8_fatal_error",
        exit_code: 0,
        pending_request_count: 1,
        had_active_request: true,
        crash_loop_guard_triggered: false,
        fatal_error_type: "FatalError",
        fatal_error_location: "CALL_AND_RETRY_LAST",
      },
    );
    expect(JSON.stringify(sendTelemetryEventMock.mock.calls)).not.toContain(
      "sensitive diagnostic report",
    );
  });
});
