import { afterEach, describe, expect, it } from "vitest";

import type { AgentContext } from "../tools/types";
import {
  acquireMutationLease,
  assertImplementerPathAllowed,
  assertMutationLease,
  beginAppFinalization,
  endAppFinalization,
  releaseMutationLease,
} from "./mutation_lease";

describe("sub-agent mutation lease", () => {
  afterEach(() => releaseMutationLease(7, "implementer-1"));

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
});
