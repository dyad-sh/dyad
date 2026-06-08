import { describe, expect, it } from "vitest";

import { resolveTargetAppPath } from "./resolve_app_context";
import type { AgentContext } from "./types";

describe("resolveTargetAppPath", () => {
  it("treats current-app aliases as the current app", () => {
    const ctx = createContext();

    expect(resolveTargetAppPath(ctx, undefined)).toBe("/apps/current");
    expect(resolveTargetAppPath(ctx, "current app")).toBe("/apps/current");
    expect(resolveTargetAppPath(ctx, " this app ")).toBe("/apps/current");
    expect(resolveTargetAppPath(ctx, "ACTIVE APP")).toBe("/apps/current");
  });

  it("still rejects unknown referenced app names", () => {
    const ctx = createContext();

    expect(() => resolveTargetAppPath(ctx, "does-not-exist")).toThrow(
      /Unknown app_name 'does-not-exist'/,
    );
  });
});

function createContext(): AgentContext {
  return {
    appPath: "/apps/current",
    referencedApps: new Map([["other-app", "/apps/other"]]),
  } as AgentContext;
}
