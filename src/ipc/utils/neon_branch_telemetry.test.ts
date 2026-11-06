import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendTelemetryEvent: vi.fn() }));
vi.mock("./telemetry", () => ({
  sendTelemetryEvent: mocks.sendTelemetryEvent,
}));

import {
  reportNeonBranchFailure,
  reportingNeonBranchCreate,
} from "./neon_branch_telemetry";

beforeEach(() => {
  mocks.sendTelemetryEvent.mockReset();
});

describe("reportNeonBranchFailure", () => {
  it("sends the status and Neon's error code from an API error", () => {
    reportNeonBranchFailure("create", "preview", {
      response: {
        status: 422,
        data: { code: "BRANCHES_LIMIT_EXCEEDED", message: "my-project" },
      },
    });

    expect(mocks.sendTelemetryEvent).toHaveBeenCalledWith(
      "neon:branch-create-failed",
      {
        kind: "preview",
        failure: "http",
        status: 422,
        errorCode: "BRANCHES_LIMIT_EXCEEDED",
      },
    );
  });

  it("reports a request that got no response as a network failure", () => {
    reportNeonBranchFailure("delete", "test", {
      code: "ECONNRESET",
      message: "socket hang up",
    });

    expect(mocks.sendTelemetryEvent).toHaveBeenCalledWith(
      "neon:branch-delete-failed",
      {
        kind: "test",
        failure: "network",
        status: undefined,
        errorCode: "ECONNRESET",
      },
    );
  });

  it("sends no free text when the error has no status or code", () => {
    reportNeonBranchFailure(
      "delete",
      "backup",
      new Error("branch br-secret-123 in project my-app"),
    );

    expect(mocks.sendTelemetryEvent).toHaveBeenCalledWith(
      "neon:branch-delete-failed",
      {
        kind: "backup",
        failure: "unknown",
        status: undefined,
        errorCode: undefined,
      },
    );
  });

  it("drops an error code that isn't a plain code", () => {
    reportNeonBranchFailure("create", "development", {
      response: { status: 400, data: { code: "Project my-app not found" } },
    });

    expect(mocks.sendTelemetryEvent).toHaveBeenCalledWith(
      "neon:branch-create-failed",
      {
        kind: "development",
        failure: "http",
        status: 400,
        errorCode: undefined,
      },
    );
  });

  it.each([
    Object.assign(new Error("aborted"), { name: "AbortError" }),
    { code: "ERR_CANCELED" },
  ])("ignores a cancelled request", (error) => {
    reportNeonBranchFailure("create", "test", error);

    expect(mocks.sendTelemetryEvent).not.toHaveBeenCalled();
  });

  it("ignores a delete of a branch that is already gone", () => {
    reportNeonBranchFailure("delete", "backup", { response: { status: 404 } });

    expect(mocks.sendTelemetryEvent).not.toHaveBeenCalled();
  });

  it("still reports a create that 404s", () => {
    reportNeonBranchFailure("create", "preview", { response: { status: 404 } });

    expect(mocks.sendTelemetryEvent).toHaveBeenCalledWith(
      "neon:branch-create-failed",
      expect.objectContaining({ failure: "http", status: 404 }),
    );
  });
});

describe("reportingNeonBranchCreate", () => {
  it("reports a failed create and rethrows the original error", async () => {
    const error = { response: { status: 500 } };

    await expect(
      reportingNeonBranchCreate("migration_source", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(mocks.sendTelemetryEvent).toHaveBeenCalledWith(
      "neon:branch-create-failed",
      {
        kind: "migration_source",
        failure: "http",
        status: 500,
        errorCode: undefined,
      },
    );
  });

  it("returns the result and sends nothing when the create succeeds", async () => {
    await expect(
      reportingNeonBranchCreate("preview", async () => "branch"),
    ).resolves.toBe("branch");
    expect(mocks.sendTelemetryEvent).not.toHaveBeenCalled();
  });
});
