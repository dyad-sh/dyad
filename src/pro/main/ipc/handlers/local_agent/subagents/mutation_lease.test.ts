import { afterEach, describe, expect, it } from "vitest";

import type { AgentContext } from "../tools/types";
import {
  acquireMutationLease,
  assertImplementerPathAllowed,
  assertMutationLease,
  beginAppFinalization,
  describeMutationBlock,
  endAppFinalization,
  normalizeMutationScope,
  releaseMutationLease,
  withMutationAdmission,
  withMutationToolAdmission,
} from "./mutation_lease";

describe("sub-agent mutation lease", () => {
  afterEach(() => {
    releaseMutationLease(7, "implementer-1");
    endAppFinalization(7);
  });

  it("blocks root mutations while an Implementer holds the app lease", () => {
    expect(
      acquireMutationLease({
        appId: 7,
        threadId: "implementer-1",
        scope: ["src/components"],
      }),
    ).toBe(true);
    expect(() => assertMutationLease({ appId: 7 } as AgentContext)).toThrow(
      /Another agent is currently editing/,
    );
    expect(() =>
      assertMutationLease({
        appId: 7,
        subagentThreadId: "implementer-1",
      } as AgentContext),
    ).not.toThrow();
  });

  it("allows only one Implementer reservation per app", () => {
    expect(
      acquireMutationLease({
        appId: 7,
        threadId: "implementer-1",
        scope: ["src/first"],
      }),
    ).toBe(true);
    expect(
      acquireMutationLease({
        appId: 7,
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
    const rootMutation = withMutationAdmission(7, () => rootFinished);
    await Promise.resolve();

    let implementerAdmitted = false;
    const implementerAdmission = withMutationAdmission(7, async () => {
      implementerAdmitted = acquireMutationLease({
        appId: 7,
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

  it("enforces the Implementer's explicit path scope", () => {
    const ctx = {
      subagentPersona: "implementer",
      subagentPathScope: ["src/components"],
    } as AgentContext;
    expect(() =>
      assertImplementerPathAllowed(ctx, "src/components/Card.tsx"),
    ).not.toThrow();
    expect(() =>
      assertImplementerPathAllowed(ctx, "src/server/secrets.ts"),
    ).toThrow(/assigned paths/);
  });

  it("uses the pre-normalized Implementer path scope", () => {
    const ctx = {
      subagentPersona: "implementer",
      subagentPathScope: ["src/components"],
    } as AgentContext;

    expect(() =>
      assertImplementerPathAllowed(ctx, "src\\components\\Card.tsx"),
    ).not.toThrow();
    expect(ctx.subagentPathScope).toEqual(["src/components"]);
  });

  it.each(["", ".", "./", "/", "..", "../src"])(
    "rejects %j as an app-root or escaping Implementer scope",
    (rootScope) => {
      const ctx = {
        subagentPersona: "implementer",
        subagentPathScope: [normalizeMutationScope(rootScope)],
      } as AgentContext;

      expect(() =>
        assertImplementerPathAllowed(ctx, "src/components/Card.tsx"),
      ).toThrow(/assigned paths/);
      expect(() =>
        acquireMutationLease({
          appId: 7,
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
    expect(beginAppFinalization(7)).toBe(true);
    expect(() => assertMutationLease({ appId: 7 } as AgentContext)).toThrow(
      /currently being finalized/,
    );
  });

  it("waits for root finalization before admitting a mutation tool", async () => {
    expect(beginAppFinalization(7)).toBe(true);
    let ran = false;
    const mutation = withMutationToolAdmission(
      { appId: 7 } as AgentContext,
      async () => {
        ran = true;
      },
    );
    await Promise.resolve();
    expect(ran).toBe(false);

    endAppFinalization(7);
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
