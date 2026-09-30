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
        "[dyad-proxy-server]started=[http://app-7.localhost:42107] original=[http://localhost:5173] mode=[host]",
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
          appUrl: "http://app-7.localhost:42107",
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

it.each(["neon", "supabase"] as const)(
  "carries %s status into authoritative readiness and clears it on recovery",
  (provider) => {
    const send = vi.fn();
    const output = new MainAppRuntimeOutput(
      7,
      { kind: "app-run", entityKey: 7, operationId: "run-1" },
      { send },
    );
    const event = {
      type: "stdout" as const,
      appId: 7,
      message:
        "[dyad-proxy-server]started=[http://app-7.localhost:42107] original=[http://localhost:32107] mode=[host]",
    };
    output.send({ ...event, previewAuth: { provider, state: "pending" } });
    expect(send.mock.calls[0][0].url.previewAuth).toEqual({
      provider,
      state: "pending",
    });
    send.mockClear();
    output.send({
      ...event,
      previewAuth: { provider, state: "error", message: "Restart and retry" },
    });
    expect(send.mock.calls[0][0].url.previewAuth).toEqual({
      provider,
      state: "error",
      message: "Restart and retry",
    });
    output.send(event);
    expect(send.mock.calls[1][0].url.previewAuth).toBeUndefined();
  },
);
