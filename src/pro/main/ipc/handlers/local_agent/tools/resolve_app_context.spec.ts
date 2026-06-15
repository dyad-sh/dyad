import { describe, expect, it } from "vitest";

import { resolveTargetAppPath } from "./resolve_app_context";
import type { AgentContext } from "./types";

describe("resolveTargetAppPath", () => {
  it("resolves the current app when app_name is omitted", () => {
    const ctx = createContext();

    expect(resolveTargetAppPath(ctx, undefined)).toBe("/apps/current");
  });

  it("resolves a referenced app by name (case-insensitive)", () => {
    const ctx = createContext();

    expect(resolveTargetAppPath(ctx, "other-app")).toBe("/apps/other");
    expect(resolveTargetAppPath(ctx, "OTHER-APP")).toBe("/apps/other");
  });

  it("rejects unknown app names, including current-app-style strings", () => {
    const ctx = createContext();

    expect(() => resolveTargetAppPath(ctx, "does-not-exist")).toThrow(
      /Unknown app_name 'does-not-exist'/,
    );
    // No alias handling: the sub-agent prompt instructs the model to omit
    // app_name for the current app rather than passing "current app".
    expect(() => resolveTargetAppPath(ctx, "current app")).toThrow(
      /Unknown app_name 'current app'/,
    );
  });
});

function createContext(): AgentContext {
  return {
    appPath: "/apps/current",
    referencedApps: new Map([["other-app", "/apps/other"]]),
  } as AgentContext;
}
