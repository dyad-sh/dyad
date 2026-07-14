import { afterEach, describe, expect, it } from "vitest";

import type { AgentContext } from "../tools/types";
import {
  acquireMutationLease,
  assertImplementerPathAllowed,
  assertMutationLease,
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
});
