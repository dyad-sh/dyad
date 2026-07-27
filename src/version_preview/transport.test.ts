import { describe, expect, it } from "vitest";
import {
  VERSION_PREVIEW_INVOCATION_KIND,
  VersionPreviewIntentEventSchema,
  VersionPreviewRemoteSnapshotSchema,
  projectVersionPreviewRemoteSnapshot,
} from "./transport";

describe("version_preview wire contracts", () => {
  it("admits renderer intents but rejects host settlements and callbacks", () => {
    expect(
      VersionPreviewIntentEventSchema.safeParse({
        type: "SELECT_VERSION",
        versionId: "abc123",
        operationId: "preview-1",
      }).success,
    ).toBe(true);
    expect(
      VersionPreviewIntentEventSchema.safeParse({
        type: "CHECKOUT_SUCCEEDED",
        invocationRef: {
          kind: VERSION_PREVIEW_INVOCATION_KIND,
          entityKey: 7,
          operationId: "preview-1",
        },
      }).success,
    ).toBe(false);
    expect(
      VersionPreviewIntentEventSchema.safeParse({
        type: "RETRY_RETURN",
        operationId: "retry-1",
        retry: () => undefined,
      }).success,
    ).toBe(false);
  });

  it("projects only serializable checkout and recovery data", () => {
    const snapshot = VersionPreviewRemoteSnapshotSchema.parse(
      projectVersionPreviewRemoteSnapshot(7, 3, {
        state: {
          type: "recovery-required",
          session: {
            appId: 7,
            originBranch: "feature/origin",
            targetVersionId: "abc123",
            checkedOutVersionId: "abc123",
            exitIntent: { type: "close" },
            selectedDiffFile: null,
            isDiffVisible: false,
          },
          error: { message: "return failed" },
        },
        activeInvocationRef: null,
        lastSettlement: {
          operationId: "return-1",
          outcome: "failed",
          error: { message: "return failed" },
        },
      }),
    );

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /retry|callback|appPath|repositoryPath/,
    );
  });
});
