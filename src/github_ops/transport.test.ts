import { describe, expect, it } from "vitest";
import { githubOpsRemoteIntentContract } from "./remote_intent_contract";
import {
  GITHUB_OPS_INVOCATION_KIND,
  GithubOpsIntentEventSchema,
  GithubOpsProducerEventSchema,
  GithubOpsRemoteSnapshotSchema,
  projectGithubOpsRemoteSnapshot,
} from "./transport";

describe("github_ops wire contracts", () => {
  it("derives trusted operation identity from the distinct stable request identity", () => {
    const convert = (requestId: string) =>
      githubOpsRemoteIntentContract.toTrustedEvent({
        key: { appId: 7 },
        intent: {
          type: "OP_REQUESTED",
          op: { type: "push", mode: "normal" },
          operationId: "renderer-reused-operation",
        },
        sender: { windowSessionId: "window-1" as never },
        requestIdentity: {
          requestId,
          messageId: `message:${requestId}`,
          idempotencyKey: `idempotency:${requestId}`,
          windowSessionId: "window-1",
        } as never,
      });

    expect(convert("request-1")).toMatchObject({
      requestId: "request-1",
      operationId: "github-operation-request:request-1",
    });
    expect(convert("request-2")).toMatchObject({
      requestId: "request-2",
      operationId: "github-operation-request:request-2",
    });
    expect(convert("request-1")).toEqual(convert("request-1"));
  });

  it("keeps renderer intents value-only and rejects host settlements", () => {
    expect(
      GithubOpsIntentEventSchema.safeParse({
        type: "OP_REQUESTED",
        op: { type: "pull" },
        operationId: "pull-1",
      }).success,
    ).toBe(true);
    expect(
      GithubOpsIntentEventSchema.safeParse({
        type: "OP_SUCCEEDED",
        op: { type: "pull" },
        invocationRef: {
          kind: GITHUB_OPS_INVOCATION_KIND,
          entityKey: 7,
          operationId: "pull-1",
        },
      }).success,
    ).toBe(false);
    expect(
      GithubOpsIntentEventSchema.safeParse({
        type: "RESOLVE_WITH_AI_STARTED",
        claimId: "claim-1",
        callback: () => undefined,
      }).success,
    ).toBe(false);
  });

  it("rejects Error instances and absolute conflict paths", () => {
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "OP_FAILED",
        op: { type: "pull" },
        failure: new Error("not encodable"),
        invocationRef: {
          kind: GITHUB_OPS_INVOCATION_KIND,
          entityKey: 7,
          operationId: "pull-1",
        },
      }).success,
    ).toBe(false);
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "CONFLICTS",
        files: ["/Users/alice/secret/app.ts"],
      }).success,
    ).toBe(false);
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "CONFLICTS",
        files: ["\\Users\\alice\\secret\\app.ts"],
      }).success,
    ).toBe(false);
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "CONFLICTS",
        files: ["src/app.tsx"],
      }).success,
    ).toBe(true);
  });

  it("projects no credential, remote URL, or absolute repository path fields", () => {
    const snapshot = GithubOpsRemoteSnapshotSchema.parse(
      projectGithubOpsRemoteSnapshot(7, 2, {
        conflictResolutionClaimId: "claim-1",
        activeRequestId: null,
        activeInvocationRef: {
          kind: GITHUB_OPS_INVOCATION_KIND,
          entityKey: 7,
          operationId: "recovery-1",
        },
        state: {
          type: "conflicted",
          files: ["src/app.tsx"],
          origin: { type: "reconcile" },
          banner: null,
        },
      }),
    );
    expect(snapshot).toMatchObject({
      appId: 7,
      revision: 2,
      conflictResolutionClaimed: true,
      state: {
        type: "conflicted",
        files: ["src/app.tsx"],
        origin: { type: "reconcile" },
        banner: null,
      },
      activeInvocationRef: {
        kind: GITHUB_OPS_INVOCATION_KIND,
        entityKey: 7,
        operationId: "recovery-1",
      },
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/accessToken|remoteUrl|appPath|repoPath/);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("claim-1");
  });
});
