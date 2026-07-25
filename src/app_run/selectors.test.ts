import { describe, expect, it } from "vitest";
import { selectAppUrl } from "./selectors";
import type { AppRunInvocationRef, RunState } from "./state";

const invocationRef: AppRunInvocationRef = {
  kind: "app-run",
  entityKey: 7,
  operationId: "run-1",
};

describe("selectAppUrl", () => {
  it("exposes ready and reloading URLs as a running-server signal", () => {
    const url = {
      appUrl: "http://localhost:4200",
      originalUrl: "http://localhost:3200",
      mode: "host" as const,
    };

    for (const state of [
      { type: "ready", appId: 7, invocationRef, url },
      {
        type: "reloading",
        appId: 7,
        invocationRef,
        reason: "manual",
        url,
      },
    ] satisfies RunState[]) {
      expect(selectAppUrl(state)).toEqual({ ...url, appId: 7 });
    }
  });

  it("intentionally drops URLs when the run stops or errors", () => {
    for (const state of [
      {
        type: "stopped",
        appId: 7,
        invocationRef,
        exitCode: 1,
        timestamp: 100,
      },
      {
        type: "errored",
        appId: 7,
        invocationRef,
        error: { message: "failed" },
      },
    ] satisfies RunState[]) {
      expect(selectAppUrl(state).appUrl).toBeNull();
    }
  });
});
