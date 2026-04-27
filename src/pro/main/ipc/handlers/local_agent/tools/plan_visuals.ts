import { z } from "zod";
import crypto from "node:crypto";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";
import {
  getMiniPlanForChat,
  updateMiniPlanVisuals,
} from "@/ipc/handlers/mini_plan_handlers";
import { MiniPlanVisualTypeSchema } from "@/ipc/types/mini_plan";
import { safeSend } from "@/ipc/utils/safe_sender";
import { waitForMiniPlanApproval } from "../tool_definitions";

const logger = log.scope("plan_visuals");

const VisualEntrySchema = z.object({
  type: MiniPlanVisualTypeSchema.describe("The type of visual asset needed"),
  description: z
    .string()
    .describe("What this visual is for and where it will be used in the app"),
  prompt: z
    .string()
    .describe(
      "A detailed image generation prompt for creating this visual. Be specific about style, composition, colors, and mood.",
    ),
});

const planVisualsSchema = z.object({
  visuals: z
    .array(VisualEntrySchema)
    .min(1, "At least one visual must be planned")
    .max(10, "Maximum 10 visuals per plan")
    .describe("Array of visual assets needed for the app"),
});

const DESCRIPTION = `Plan the visual assets needed for the app and generate image generation prompts for each.

<when_to_use>
Use this tool AFTER creating the mini plan with write_mini_plan. Analyze the app concept and determine what visual assets are needed.
</when_to_use>

<guidelines>
- Consider what visuals would make the app look polished and professional
- Common visual types:
  - "logo": App logo or brand mark
  - "photo": Photography for hero sections, backgrounds, product images
  - "illustration": Custom illustrations for empty states, onboarding, features
  - "icon": Custom icons beyond standard icon libraries
  - "background": Decorative backgrounds, patterns, textures
  - "other": Any other visual asset
- Generate specific, detailed prompts that will produce high-quality images
- Consider the design direction and main color from the mini plan
- Keep the number of visuals reasonable (3-6 is typical)
</guidelines>

<example>
{
  "visuals": [
    {
      "type": "logo",
      "description": "App logo for the restaurant website header",
      "prompt": "Minimalist restaurant logo, warm orange tones, fork and knife silhouette integrated into letterform, clean vector style, white background"
    },
    {
      "type": "photo",
      "description": "Hero section background showing restaurant ambiance",
      "prompt": "Warm inviting restaurant interior, soft ambient lighting, wooden tables, bokeh background, food photography style, warm color grading"
    },
    {
      "type": "illustration",
      "description": "Empty cart state illustration",
      "prompt": "Friendly minimal illustration of an empty plate with cutlery, pastel colors, flat design style, welcoming mood"
    }
  ]
}
</example>`;

export const planVisualsTool: ToolDefinition<
  z.infer<typeof planVisualsSchema>
> = {
  name: "plan_visuals",
  description: DESCRIPTION,
  inputSchema: planVisualsSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Plan Visuals (${args.visuals.length} assets)`,

  execute: async (args, ctx: AgentContext) => {
    if (!getMiniPlanForChat(ctx.chatId)) {
      return "Error: No mini plan found. Call write_mini_plan first.";
    }

    logger.log(`Planning ${args.visuals.length} visuals`);

    const visuals = args.visuals.map((v) => ({
      id: `visual_${crypto.randomUUID().slice(0, 8)}`,
      type: v.type,
      description: v.description,
      prompt: v.prompt,
    }));

    updateMiniPlanVisuals(ctx.chatId, visuals);

    safeSend(ctx.event.sender, "mini-plan:visuals-update", {
      chatId: ctx.chatId,
      visuals,
      complete: true,
    });

    logger.log(`Waiting for user to approve mini plan for chat ${ctx.chatId}`);

    const approved = await waitForMiniPlanApproval(
      ctx.chatId,
      ctx.event.sender,
    );

    if (!approved) {
      return "The user dismissed the mini plan without approving. Ask them how they'd like to proceed.";
    }

    // Read back the plan data which may have been edited by the user
    const approvedPlan = getMiniPlanForChat(ctx.chatId);
    if (!approvedPlan) {
      return "The mini plan was approved but the data is no longer available. Ask the user to try again.";
    }

    const visualsSummary =
      approvedPlan.visuals.length > 0
        ? approvedPlan.visuals
            .map((v) => `- ${v.type}: ${v.description}\n  Prompt: ${v.prompt}`)
            .join("\n")
        : "No visuals planned";

    return [
      `[Mini Plan Approved]`,
      `App Name: ${approvedPlan.appName}`,
      `Template: ${approvedPlan.templateId}`,
      `Theme: ${approvedPlan.themeId}`,
      `Main Color: ${approvedPlan.mainColor}`,
      `Design Direction: ${approvedPlan.designDirection}`,
      ``,
      `Visual Assets:`,
      visualsSummary,
      ``,
      `Original Prompt: ${approvedPlan.userPrompt}`,
      ``,
      `The user has approved the mini plan. Proceed with building the app based on the approved plan above.`,
    ].join("\n");
  },
};
