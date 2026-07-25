import { describe, expect, it, vi } from "vitest";
import { MainAppRuntimeOutput } from "./main_app_runtime_output";

describe("MainAppRuntimeOutput", () => {
  it("turns proxy, HMR, and exit output into invocation-bound producer events", () => {
    const send = vi.fn();
    const output = new MainAppRuntimeOutput(
      7,
      { kind: "app-run", entityKey: 7, operationId: "run-1" },
      { send },
    );

    output.enqueue({
      type: "stdout",
      appId: 7,
      message:
        "[dyad-proxy-server]started=[http://localhost:3210] original=[http://localhost:5173] mode=[host]",
    });
    output.enqueue({
      type: "stdout",
      appId: 7,
      message: "[vite] hmr update /src/App.tsx",
    });
    output.send({
      type: "app-exit",
      appId: 7,
      message: "App exited",
      exitCode: 1,
      timestamp: 50,
      invocationRef: {
        kind: "app-run",
        entityKey: 7,
        operationId: "untrusted-other-run",
      },
    });

    expect(send.mock.calls.map(([event]) => event)).toEqual([
      {
        type: "PROXY_READY",
        invocationRef: {
          kind: "app-run",
          entityKey: 7,
          operationId: "run-1",
        },
        url: {
          appUrl: "http://localhost:3210",
          originalUrl: "http://localhost:5173",
          mode: "host",
        },
      },
      {
        type: "HMR_DETECTED",
        invocationRef: {
          kind: "app-run",
          entityKey: 7,
          operationId: "run-1",
        },
      },
      {
        type: "PROCESS_EXITED",
        invocationRef: {
          kind: "app-run",
          entityKey: 7,
          operationId: "run-1",
        },
        exitCode: 1,
        timestamp: 50,
      },
    ]);
  });
});
