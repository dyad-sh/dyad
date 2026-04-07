import crypto from "node:crypto";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMiniPlanForChat } from "@/ipc/handlers/mini_plan_handlers";
import {
  MiniPlanFieldEditSchema,
  type MiniPlanVisual,
} from "@/ipc/types/mini_plan";
import { planVisualsTool } from "@/pro/main/ipc/handlers/local_agent/tools/plan_visuals";
import {
  type AgentContext,
  type Todo,
} from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { writeMiniPlanTool } from "@/pro/main/ipc/handlers/local_agent/tools/write_mini_plan";

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

vi.mock("@/pro/main/ipc/handlers/local_agent/tool_definitions", () => ({
  waitForMiniPlanApproval: vi.fn(async () => true),
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
    messageId: 1,
    isSharedModulesChanged: false,
    todos: [] as Todo[],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    isDyadPro: true,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn(async () => true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };
}

describe("mini plan tools", () => {
  beforeEach(() => {
    safeSend.mockReset();
  });

  it("persists mini plan data when write_mini_plan executes", async () => {
    const chatId = 1001;
    const ctx = createAgentContext(chatId);

    await writeMiniPlanTool.execute(
      {
        app_name: "Lumen Notes",
        user_prompt: "Build me a beautiful notes app",
        attachments: ["docs/spec.md"],
        template_id: "react",
        theme_id: "default",
        design_direction:
          "Clean and polished productivity interface with warm accents.",
        main_color: "#F59E0B",
      },
      ctx,
    );

    expect(getMiniPlanForChat(chatId)).toMatchObject({
      appName: "Lumen Notes",
      userPrompt: "Build me a beautiful notes app",
      attachments: ["docs/spec.md"],
      templateId: "react",
      themeId: "default",
      designDirection:
        "Clean and polished productivity interface with warm accents.",
      mainColor: "#F59E0B",
      visuals: [],
      approved: false,
    });

    expect(safeSend).toHaveBeenCalledWith(
      ctx.event.sender,
      "mini-plan:update",
      {
        chatId,
        data: expect.objectContaining({
          appName: "Lumen Notes",
          visuals: [],
        }),
      },
    );
  });

  it("updates persisted visuals when plan_visuals executes", async () => {
    const chatId = 1002;
    const ctx = createAgentContext(chatId);
    const uuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("12345678-1234-5678-90ab-1234567890ab");

    await writeMiniPlanTool.execute(
      {
        app_name: "Template Trial",
        user_prompt: "Build me a polished notes app",
        attachments: [],
        template_id: "react",
        theme_id: "default",
        design_direction: "Simple and professional with strong readability.",
        main_color: "#2563EB",
      },
      ctx,
    );

    const visualsInput = [
      {
        type: "logo" as const,
        description: "App logo for the notes dashboard",
        prompt: "Minimal notes app logo in cobalt blue",
      },
    ];

    await planVisualsTool.execute({ visuals: visualsInput }, ctx);

    const persistedVisuals = getMiniPlanForChat(chatId)?.visuals;
    expect(persistedVisuals).toEqual([
      {
        id: "visual_12345678",
        type: "logo",
        description: "App logo for the notes dashboard",
        prompt: "Minimal notes app logo in cobalt blue",
      },
    ] satisfies MiniPlanVisual[]);

    expect(safeSend).toHaveBeenLastCalledWith(
      ctx.event.sender,
      "mini-plan:visuals-update",
      {
        chatId,
        visuals: persistedVisuals,
      },
    );

    uuidSpy.mockRestore();
  });

  it("rejects invalid field names in mini plan edits", () => {
    expect(() =>
      MiniPlanFieldEditSchema.parse({
        chatId: 1,
        field: "unknownField",
        value: "x",
      }),
    ).toThrow();

    expect(
      MiniPlanFieldEditSchema.parse({
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
