import { describe, expect, it } from "vitest";
import {
  GITHUB_OPS_INVOCATION_KIND,
  GithubOperationResultSchema,
  GithubOpsIntentEventSchema,
  GithubOpsProducerEventSchema,
  GithubOpsRemoteSnapshotSchema,
  projectGithubOpsRemoteSnapshot,
} from "./transport";

describe("github_ops wire contracts", () => {
  it("keeps renderer intents value-only and rejects host settlements", () => {
    expect(
      GithubOpsIntentEventSchema.safeParse({
        type: "OP_REQUESTED",
        op: { type: "pull", provider: "github" },
        operationId: "pull-1",
      }).success,
    ).toBe(true);
    expect(
      GithubOpsIntentEventSchema.safeParse({
        type: "OP_SUCCEEDED",
        op: { type: "pull", provider: "github" },
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
    expect(
      GithubOpsIntentEventSchema.safeParse({
        type: "CONFLICT_RESOLUTION_FINISHED",
        chatId: 42,
      }).success,
    ).toBe(true);
    expect(
      GithubOpsIntentEventSchema.safeParse({
        type: "CONFLICT_RESOLUTION_FINISHED",
      }).success,
    ).toBe(false);
  });

  it("rejects Error instances and absolute conflict paths", () => {
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "CONFLICT_VERIFICATION_FAILED",
        verificationAttempt: 1,
        message: "Could not verify the resolved conflicts",
      }).success,
    ).toBe(true);
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "OP_FAILED",
        op: { type: "pull", provider: "github" },
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
        provider: "github",
        files: ["/Users/alice/secret/app.ts"],
      }).success,
    ).toBe(false);
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "CONFLICTS",
        provider: "github",
        files: ["\\Users\\alice\\secret\\app.ts"],
      }).success,
    ).toBe(false);
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "CONFLICTS",
        provider: "github",
        files: ["src/app.tsx"],
      }).success,
    ).toBe(true);
  });

  it("projects no credential, remote URL, or absolute repository path fields", () => {
    const snapshot = GithubOpsRemoteSnapshotSchema.parse(
      projectGithubOpsRemoteSnapshot(7, 2, {
        conflictResolutionClaimId: "claim-1",
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

describe("push summary wire shape", () => {
  const invocationRef = {
    kind: GITHUB_OPS_INVOCATION_KIND,
    entityKey: 7,
    operationId: "push-1",
  };
  const op = { type: "push", mode: "normal", provider: "github" };

  it("accepts a settlement with or without a summary", () => {
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "OP_SUCCEEDED",
        op,
        invocationRef,
      }).success,
    ).toBe(true);
    expect(
      GithubOpsProducerEventSchema.safeParse({
        type: "OP_SUCCEEDED",
        op,
        invocationRef,
        result: {
          type: "push",
          summary: {
            outcome: "wrong-branch",
            pushedBranch: "other2",
            currentBranch: "main",
            commitsPushed: 0,
            files: null,
            uncommittedFiles: 0,
            commitsNotOnRemote: 5,
            head: "ffb1463",
            remoteTip: "c872cc3",
          },
        },
      }).success,
    ).toBe(true);
  });

  it("rejects summaries carrying anything but counts, names, and commits", () => {
    const summary = {
      outcome: "pushed",
      pushedBranch: "main",
      currentBranch: "main",
      commitsPushed: 1,
      files: null,
      uncommittedFiles: 0,
      commitsNotOnRemote: 0,
      head: "ffb1463",
      remoteTip: null,
    };
    const parse = (overrides: Record<string, unknown>) =>
      GithubOperationResultSchema.safeParse({
        type: "push",
        summary: { ...summary, ...overrides },
      });

    const pathAsCommit = parse({ head: "/Users/someone/app" });
    expect(pathAsCommit.success).toBe(false);
    expect(pathAsCommit.error?.issues[0]?.path).toEqual(["summary", "head"]);

    const extraField = parse({ repoPath: "/Users/someone/app" });
    expect(extraField.success).toBe(false);
    expect(extraField.error?.issues[0]?.code).toBe("unrecognized_keys");
  });
});

describe("banner detail on the wire", () => {
  it("carries the second banner line through the snapshot schema", () => {
    const snapshot = GithubOpsRemoteSnapshotSchema.parse(
      projectGithubOpsRemoteSnapshot(7, 3, {
        conflictResolutionClaimId: null,
        activeInvocationRef: null,
        state: {
          type: "idle",
          banner: {
            kind: "warning",
            completedOperation: "push",
            message: "You're working on main, but Dyad syncs other2.",
            detail:
              "other2 was already up to date. 5 commits on main are not on GitHub's other2.",
          },
        },
      }),
    );
    expect(snapshot.state).toMatchObject({
      banner: {
        detail:
          "other2 was already up to date. 5 commits on main are not on GitHub's other2.",
      },
    });
  });
});
