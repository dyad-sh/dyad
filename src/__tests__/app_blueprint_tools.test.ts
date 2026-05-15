import crypto from "node:crypto";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppBlueprintForChat } from "@/ipc/handlers/app_blueprint_handlers";
import {
  AppBlueprintFieldEditSchema,
  type AppBlueprintVisual,
} from "@/ipc/types/app_blueprint";
import {
  type AgentContext,
  type Todo,
} from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { writeAppBlueprintTool } from "@/pro/main/ipc/handlers/local_agent/tools/write_app_blueprint";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const safeSend = vi.fn();

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: (...args: unknown[]) => safeSend(...args),
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    selectedTemplateId: "react",
    selectedThemeId: "default",
  }),
}));

function createAgentContext(chatId: number): AgentContext {
  const sender = {
    isDestroyed: () => false,
    isCrashed: () => false,
    send: vi.fn(),
  } as unknown as WebContents;

  return {
    event: { sender } as IpcMainInvokeEvent,
    appId: 1,
    appPath: "/tmp/test-app",
    chatId,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    todos: [] as Todo[],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    referencedApps: new Map<string, string>(),
    isDyadPro: true,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn(async () => true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };
}

describe("app blueprint tools", () => {
  beforeEach(() => {
    safeSend.mockReset();
  });

  it("persists app blueprint data when write_app_blueprint executes", async () => {
    const chatId = 1001;
    const ctx = createAgentContext(chatId);
    const uuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("12345678-1234-5678-90ab-1234567890ab");

    await writeAppBlueprintTool.execute(
      {
        app_name: "Lumen Notes",
        user_prompt: "Build me a beautiful notes app",
        attachments: ["docs/spec.md"],
        template_id: "react",
        theme_id: "default",
        design_direction:
          "Clean and polished productivity interface with warm accents.",
        primary_color: "#F59E0B",
        visuals: [
          {
            type: "logo",
            description: "App logo for the notes dashboard",
            prompt: "Minimal notes app logo in amber tones",
          },
        ],
      },
      ctx,
    );

    expect(getAppBlueprintForChat(chatId)).toMatchObject({
      appName: "Lumen Notes",
      userPrompt: "Build me a beautiful notes app",
      attachments: ["docs/spec.md"],
      templateId: "react",
      themeId: "default",
      designDirection:
        "Clean and polished productivity interface with warm accents.",
      primaryColor: "#F59E0B",
      visuals: [
        {
          id: "visual_12345678",
          type: "logo",
          description: "App logo for the notes dashboard",
          prompt: "Minimal notes app logo in amber tones",
        },
      ] satisfies AppBlueprintVisual[],
      approved: false,
    });

    expect(safeSend).toHaveBeenCalledWith(
      ctx.event.sender,
      "app-blueprint:update",
      {
        chatId,
        data: expect.objectContaining({
          appName: "Lumen Notes",
          visuals: [expect.objectContaining({ type: "logo" })],
        }),
      },
    );

    uuidSpy.mockRestore();
  });

  it("falls back to user's selectedTemplateId when template_id is omitted", async () => {
    const chatId = 1002;
    const ctx = createAgentContext(chatId);

    await writeAppBlueprintTool.execute(
      {
        app_name: "Template Fallback",
        user_prompt: "Build me a polished notes app",
        attachments: [],
        design_direction: "Simple and professional with strong readability.",
        primary_color: "#2563EB",
        visuals: [
          {
            type: "logo",
            description: "App logo",
            prompt: "Minimal logo",
          },
        ],
      },
      ctx,
    );

    expect(getAppBlueprintForChat(chatId)).toMatchObject({
      templateId: "react",
      themeId: "default",
    });
  });

  it("rejects invalid field names in app blueprint edits", () => {
    expect(() =>
      AppBlueprintFieldEditSchema.parse({
        chatId: 1,
        field: "unknownField",
        value: "x",
      }),
    ).toThrow();

    expect(
      AppBlueprintFieldEditSchema.parse({
        chatId: 1,
        field: "themeId",
        value: "default",
      }),
    ).toMatchObject({
      chatId: 1,
      field: "themeId",
      value: "default",
    });
  });
});
