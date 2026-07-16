import { describe, expect, it } from "vitest";

import { BUILD_SYSTEM_PREFIX } from "@/prompts/system_prompt";

describe("build system prompt", () => {
  it("uses context-sensitive component placement and error handling", () => {
    expect(BUILD_SYSTEM_PREFIX).toContain(
      "Create a separate file when a component or hook is reusable, substantial",
    );
    expect(BUILD_SYSTEM_PREFIX).toContain(
      "Small task-specific components and hooks may stay in a related file",
    );
    expect(BUILD_SYSTEM_PREFIX).toContain(
      "Handle expected failures at appropriate boundaries",
    );
    expect(BUILD_SYSTEM_PREFIX).not.toContain(
      "new file for every new component or hook",
    );
    expect(BUILD_SYSTEM_PREFIX).not.toContain(
      "Don't catch errors with try/catch blocks unless specifically requested",
    );
  });
});
