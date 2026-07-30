import { describe, expect, it } from "vitest";
import {
  VersionPreviewEnqueueError,
  VersionPreviewOperationOutcomeSchema,
  versionPreviewOperationRegistry,
} from "./operations";

describe("VersionPreviewOperationOutcomeSchema", () => {
  it("accepts serialized failures and rejects Error instances", () => {
    expect(
      VersionPreviewOperationOutcomeSchema.safeParse({
        kind: "failed",
        operation: "restore",
        error: { message: "Git checkout failed" },
      }).success,
    ).toBe(true);

    expect(
      VersionPreviewOperationOutcomeSchema.safeParse({
        kind: "failed",
        operation: "restore",
        error: new Error("Git checkout failed"),
      }).success,
    ).toBe(false);
  });

  it("preserves the failing intent's operation on enqueue failure", () => {
    expect(
      versionPreviewOperationRegistry.enqueueFailureOutcome(
        new VersionPreviewEnqueueError(
          "restore-to-message",
          new Error("enqueue failed"),
        ),
      ),
    ).toEqual({
      kind: "failed",
      operation: "restore-to-message",
      error: { message: "enqueue failed" },
    });
    expect(() =>
      versionPreviewOperationRegistry.enqueueFailureOutcome(
        new Error("missing context"),
      ),
    ).toThrow("missing operation context");
  });
});
