import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";

const logger = log.scope("write_mini_plan");

const writeMiniPlanSchema = z.object({
  app_name: z
    .string()
    .describe(
      "A creative, memorable app name generated based on the user's prompt",
    ),
  user_prompt: z
    .string()
    .describe(
      "The original user prompt that describes what they want to build",
    ),
  attachments: z
    .array(z.string())
    .optional()
    .default([])
    .describe("File paths of user attachments from the original prompt"),
  template_id: z
    .string()
    .optional()
    .default("react")
    .describe(
      'The template/tech stack to use. Default: "react" (Vite + React + Shadcn + Tailwind + TypeScript). Other options: "next" (Next.js)',
    ),
  theme_id: z
    .string()
    .optional()
    .default("default")
    .describe(
      'The theme to apply. Default: "default". Use the default theme unless the user specifies a preference.',
    ),
  design_direction: z
    .string()
    .describe(
      "A brief description of the design direction for the app. Consider the industry, target audience, and mood. Example: 'Modern and professional with clean typography for a B2B SaaS dashboard'",
    ),
  main_color: z
    .string()
    .describe(
      "The primary/accent color for the app as a hex code. Choose based on the industry and design direction. Example: '#3B82F6'",
    ),
});

const DESCRIPTION = `Create or update a mini plan card for the user to review before building begins.

The mini plan is a lightweight configuration step — it captures key decisions about the app before implementation starts. The user can modify any field directly in the card or ask you to update it.

<when_to_use>
Use this tool AFTER gathering any needed preferences (via mini_plan_questionnaire or from the user's prompt).
Call this tool to present the initial mini plan, or to update it when the user requests changes.
</when_to_use>

<guidelines>
- app_name: Generate a creative, memorable name that reflects the app's purpose. Keep it short (1-3 words).
- template_id: Default to "react" unless the user specifically asks for Next.js or another framework.
- theme_id: Default to "default" unless the user has a specific theme preference.
- design_direction: Analyze the industry, target users, and purpose to determine the right visual approach. Be specific but concise (1-2 sentences).
- main_color: Pick a color that fits the industry and design direction. Use hex format.
</guidelines>

<example>
{
  "app_name": "FreshBite",
  "user_prompt": "Build me a restaurant website with online ordering",
  "template_id": "react",
  "theme_id": "default",
  "design_direction": "Warm and inviting with food photography emphasis, modern restaurant aesthetic with easy-to-navigate ordering flow",
  "main_color": "#E85D04"
}
</example>`;

export const writeMiniPlanTool: ToolDefinition<
  z.infer<typeof writeMiniPlanSchema>
> = {
  name: "write_mini_plan",
  description: DESCRIPTION,
  inputSchema: writeMiniPlanSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Mini Plan: ${args.app_name}`,

  buildXml: (args, isComplete) => {
    if (!args.app_name) return undefined;

    const appName = escapeXmlAttr(args.app_name);
    const template = args.template_id
      ? escapeXmlAttr(args.template_id)
      : "react";
    const theme = args.theme_id ? escapeXmlAttr(args.theme_id) : "default";
    const designDirection = args.design_direction
      ? escapeXmlAttr(args.design_direction)
      : "";
    const mainColor = args.main_color ? escapeXmlAttr(args.main_color) : "";

    return `<dyad-mini-plan app-name="${appName}" template="${template}" theme="${theme}" design-direction="${designDirection}" main-color="${mainColor}" complete="${isComplete}"></dyad-mini-plan>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Writing mini plan: ${args.app_name}`);

    safeSend(ctx.event.sender, "mini-plan:update", {
      chatId: ctx.chatId,
      data: {
        appName: args.app_name,
        userPrompt: args.user_prompt,
        attachments: args.attachments ?? [],
        templateId: args.template_id ?? "react",
        themeId: args.theme_id ?? "default",
        designDirection: args.design_direction,
        mainColor: args.main_color,
        visuals: [],
      },
    });

    return `Mini plan "${args.app_name}" has been presented to the user. They can review and modify it in the chat. Now use the plan_visuals tool to determine what visuals the app needs.`;
  },
};
