import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentContext } from "../tools/types";
import {
  acquireMutationLease,
  assertMutationLease,
  beginAppFinalization,
  describeMutationBlock,
  endAppFinalization,
  quarantineActiveMutationTool,
  releaseMutationLease,
  waitForMutationToolDrain,
  withMutationAdmission,
  withMutationAdmissionUntil,
  withMutationToolAdmission,
} from "./mutation_lease";

describe("sub-agent mutation lease", () => {
  let nextAppId = 70_000;
  let appId: number;

  beforeEach(() => {
    appId = nextAppId++;
  });

  afterEach(() => {
    releaseMutationLease(appId, "implementer-1");
    endAppFinalization(appId);
  });

  it("blocks root mutations while an Implementer holds the app lease", () => {
    expect(
      acquireMutationLease({
        appId,
        threadId: "implementer-1",
        scope: ["src/components"],
      }),
    ).toBe(true);
    expect(() => assertMutationLease({ appId } as AgentContext)).toThrow(
      /Another agent is currently editing/,
    );
    expect(() =>
      assertMutationLease({
        appId,
        subagentThreadId: "implementer-1",
      } as AgentContext),
    ).not.toThrow();
  });

  it("allows only one Implementer reservation per app", () => {
    expect(
      acquireMutationLease({
        appId,
        threadId: "implementer-1",
        scope: ["src/first"],
      }),
    ).toBe(true);
    expect(
      acquireMutationLease({
        appId,
        threadId: "implementer-2",
        scope: ["src/second"],
      }),
    ).toBe(false);
  });

  it("serializes root mutation work with Implementer admission", async () => {
    let releaseRoot!: () => void;
    const rootFinished = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    const rootMutation = withMutationAdmission(appId, () => rootFinished);
    await Promise.resolve();

    let implementerAdmitted = false;
    const implementerAdmission = withMutationAdmission(appId, async () => {
      implementerAdmitted = acquireMutationLease({
        appId,
        threadId: "implementer-1",
        scope: ["src"],
      });
    });
    await Promise.resolve();
    expect(implementerAdmitted).toBe(false);

    releaseRoot();
    await Promise.all([rootMutation, implementerAdmission]);
    expect(implementerAdmitted).toBe(true);
  });

  it.each(["", ".", "./", "/", "..", "../src"])(
    "rejects %j as an app-root or escaping Implementer scope",
    (rootScope) => {
      expect(() =>
        acquireMutationLease({
          appId,
          threadId: "implementer-1",
          scope: [rootScope],
        }),
      ).toThrow(/explicit relative paths/);
    },
  );

  it("rejects Implementer mutations after its writer lease is gone", () => {
    expect(() =>
      assertMutationLease({
        appId: 10,
        subagentThreadId: "implementer",
        subagentPersona: "implementer",
      } as AgentContext),
    ).toThrow(/no longer owns/);
  });

  it("blocks new writer leases while the root finalizes", () => {
    expect(beginAppFinalization(8)).toBe(true);
    expect(
      acquireMutationLease({
        appId: 8,
        threadId: "late-implementer",
        scope: ["src"],
      }),
    ).toBe(false);
    endAppFinalization(8);
    expect(
      acquireMutationLease({
        appId: 8,
        threadId: "late-implementer",
        scope: ["src"],
      }),
    ).toBe(true);
    releaseMutationLease(8, "late-implementer");
  });

  it("blocks normal mutation tools while the root finalizes", () => {
    expect(beginAppFinalization(appId)).toBe(true);
    expect(() => assertMutationLease({ appId } as AgentContext)).toThrow(
      /currently being finalized/,
    );
  });

  it("waits for root finalization before admitting a mutation tool", async () => {
    expect(beginAppFinalization(appId)).toBe(true);
    let ran = false;
    const mutation = withMutationToolAdmission(
      { appId } as AgentContext,
      async () => {
        ran = true;
      },
    );
    await Promise.resolve();
    expect(ran).toBe(false);

    endAppFinalization(appId);
    await mutation;
    expect(ran).toBe(true);
  });

  it("does not begin root finalization while a writer owns the lease", () => {
    expect(
      acquireMutationLease({
        appId: 9,
        threadId: "implementer",
        scope: ["src"],
      }),
    ).toBe(true);
    expect(beginAppFinalization(9)).toBe(false);
    releaseMutationLease(9, "implementer");
  });

  it("does not begin root finalization while a mutation tool is still active", async () => {
    let finishMutation!: () => void;
    const mutation = withMutationToolAdmission(
      { appId } as AgentContext,
      () =>
        new Promise<void>((resolve) => {
          finishMutation = resolve;
        }),
    );
    await Promise.resolve();

    expect(beginAppFinalization(appId)).toBe(false);
    expect(describeMutationBlock(appId)).toContain("mutation tool");

    finishMutation();
    await mutation;
    expect(beginAppFinalization(appId)).toBe(true);
  });

  it("serializes ordinary parallel mutation tools", async () => {
    let finishFirst!: () => void;
    const order: string[] = [];
    const first = withMutationToolAdmission(
      { appId } as AgentContext,
      () =>
        new Promise<void>((resolve) => {
          order.push("first-started");
          finishFirst = () => {
            order.push("first-finished");
            resolve();
          };
        }),
    );
    const second = withMutationToolAdmission(
      { appId } as AgentContext,
      async () => {
        order.push("second-started");
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["first-started"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "first-started",
      "first-finished",
      "second-started",
    ]);
  });

  it("rejects queued admission when an active mutation is quarantined", async () => {
    let finishMutation!: () => void;
    const mutation = withMutationToolAdmission(
      { appId } as AgentContext,
      () =>
        new Promise<void>((resolve) => {
          finishMutation = resolve;
        }),
    );
    await Promise.resolve();

    let admitted = false;
    const waiting = withMutationAdmissionUntil({
      appId,
      deadlineAt: Date.now() + 10_000,
      operation: async () => {
        admitted = true;
      },
    });
    expect(quarantineActiveMutationTool(appId)).toBe(true);

    await expect(waiting).rejects.toThrow(/cancelled mutation tool/);
    expect(admitted).toBe(false);
    finishMutation();
    await mutation;
    await Promise.resolve();
    expect(admitted).toBe(false);
  });

  it("does not run an admission callback after its wait is cancelled", async () => {
    let finishMutation!: () => void;
    const mutation = withMutationToolAdmission(
      { appId } as AgentContext,
      () =>
        new Promise<void>((resolve) => {
          finishMutation = resolve;
        }),
    );
    await Promise.resolve();

    const controller = new AbortController();
    let admitted = false;
    const waiting = withMutationAdmissionUntil({
      appId,
      abortSignal: controller.signal,
      deadlineAt: Date.now() + 10_000,
      operation: async () => {
        admitted = true;
      },
    });
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ kind: "user_cancelled" });
    finishMutation();
    await mutation;
    await Promise.resolve();
    expect(admitted).toBe(false);
  });

  it("times out a drain without leaving a polling loop", async () => {
    let finishMutation!: () => void;
    const mutation = withMutationToolAdmission(
      { appId } as AgentContext,
      () =>
        new Promise<void>((resolve) => {
          finishMutation = resolve;
        }),
    );
    await Promise.resolve();

    await expect(waitForMutationToolDrain(appId, 1)).resolves.toBe(false);
    finishMutation();
    await mutation;
    await expect(waitForMutationToolDrain(appId, 1)).resolves.toBe(true);
  });

  it("names the blocking holder so a stuck finalization is attributable", () => {
    // A held lease was once completely silent — the finalization timeout said
    // only "another app operation may still be active", and attributing it to
    // a hung Implementer's orphaned lease took a full forensic pass.
    expect(describeMutationBlock(11)).toBeNull();
    acquireMutationLease({
      appId: 11,
      threadId: "impl-11",
      scope: ["src/app"],
    });
    expect(describeMutationBlock(11)).toContain("impl-11");
    expect(describeMutationBlock(11)).toContain("src/app");
    releaseMutationLease(11, "impl-11");

    expect(beginAppFinalization(11)).toBe(true);
    expect(describeMutationBlock(11)).toContain("finalization");
    endAppFinalization(11);
    expect(describeMutationBlock(11)).toBeNull();
  });
});
