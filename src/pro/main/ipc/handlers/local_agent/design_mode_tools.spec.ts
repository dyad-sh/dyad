import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSettings } from "@/main/settings";
import { generateImageTool } from "./tools/generate_image";
import { writeFileTool } from "./tools/write_file";
import { designInterfaceTool } from "./tools/design_interface";
import { shouldIncludeTool } from "./tool_definitions";
import type { AgentContext } from "./tools/types";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({})),
  writeSettings: vi.fn(),
}));

function createDesignContext(): AgentContext {
  return {
    event: {} as any,
    appId: 1,
    appPath: "/tmp/app",
    referencedApps: new Map(),
    chatId: 42,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    // generate_image is Pro-gated by its own isEnabled predicate.
    isDyadPro: true,
    designMode: true,
    todos: [],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };
}

describe("design mode image generation tool gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSettings).mockReturnValue(
      {} as ReturnType<typeof readSettings>,
    );
  });

  it("excludes generate_image from design mode by default", () => {
    expect(
      shouldIncludeTool(generateImageTool, createDesignContext(), {
        designModeOnly: true,
      }),
    ).toBe(false);
  });

  it("includes generate_image in design mode when images are enabled", () => {
    expect(
      shouldIncludeTool(generateImageTool, createDesignContext(), {
        designModeOnly: true,
        enableDesignImages: true,
      }),
    ).toBe(true);
  });

  it("still requires Pro for generate_image in design mode", () => {
    const ctx = createDesignContext();
    ctx.isDyadPro = false;
    expect(
      shouldIncludeTool(generateImageTool, ctx, {
        designModeOnly: true,
        enableDesignImages: true,
      }),
    ).toBe(false);
  });

  it("keeps the rest of design mode read-only when images are enabled", () => {
    expect(
      shouldIncludeTool(writeFileTool, createDesignContext(), {
        designModeOnly: true,
        enableDesignImages: true,
      }),
    ).toBe(false);
  });

  it("does not leak the design image allowance into other modes", () => {
    const ctx = createDesignContext();
    ctx.designMode = false;
    // Plan mode is read-only, and enableDesignImages must not change that.
    expect(
      shouldIncludeTool(generateImageTool, ctx, {
        planModeOnly: true,
        enableDesignImages: true,
      }),
    ).toBe(false);
    expect(
      shouldIncludeTool(generateImageTool, ctx, {
        readOnly: true,
        enableDesignImages: true,
      }),
    ).toBe(false);
  });

  it("keeps design_interface available regardless of the image toggle", () => {
    for (const enableDesignImages of [true, false]) {
      expect(
        shouldIncludeTool(designInterfaceTool, createDesignContext(), {
          designModeOnly: true,
          enableDesignImages,
        }),
      ).toBe(true);
    }
  });
});
