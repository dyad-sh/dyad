import { describe, expect, it } from "vitest";

import { DESKTOP_APPS, desktopAppIdForPath } from "@/lib/desktop/desktop_apps";

describe("Desktop Mode application parity", () => {
  it("includes every primary destination exposed by normal mode", () => {
    const normalModePaths = [
      "/knowledge-core",
      "/chat-agent",
      "/coder",
      "/planner",
      "/agent-os",
      "/assembler3d",
      "/dev-ops",
      "/library",
      "/knowledge-base",
      "/storage",
      "/apps",
      "/hub",
      "/settings",
    ];

    for (const path of normalModePaths) {
      expect(desktopAppIdForPath(path), path).toBeDefined();
    }
  });

  it("includes Build Studio and Assembler in the desktop launcher", () => {
    expect(DESKTOP_APPS.map((app) => app.id)).toEqual(
      expect.arrayContaining(["build-studio", "assembler"]),
    );
  });

  it("hands nested normal-mode routes to the correct desktop app", () => {
    expect(desktopAppIdForPath("/coder/studio")).toBe("build-studio");
    expect(desktopAppIdForPath("/coder/helix")).toBe("helix");
    expect(desktopAppIdForPath("/app-details")).toBe("apps");
    expect(desktopAppIdForPath("/settings/providers/openrouter")).toBe(
      "settings",
    );
  });
});
