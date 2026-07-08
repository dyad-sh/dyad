import { z } from "zod";
import crypto from "node:crypto";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";
import { saveDesignBrief } from "@/ipc/utils/design_persistence";
import {
  DesignBriefDataSchema,
  DesignPaletteSchema,
  DesignTypographySchema,
} from "@/ipc/types/design";

const logger = log.scope("write_design_brief");

const InterfaceSummarySchema = z.object({
  name: z.string().describe("Short, clear screen name, e.g. 'Landing page'"),
  purpose: z
    .string()
    .optional()
    .describe("One line on what this screen is for and its primary action"),
});

const writeDesignBriefSchema = z.object({
  app_name: z
    .string()
    .describe("A creative, memorable app name (1-3 words) based on the idea"),
  user_prompt: z
    .string()
    .describe("The original user description of the app being designed"),
  design_direction: z
    .string()
    .describe(
      "1-2 sentences describing the visual mood and rationale, informed by the industry and audience",
    ),
  palette: DesignPaletteSchema.describe(
    "The app's color system as hex codes. Choose colors with strong contrast and a coherent mood.",
  ),
  typography: DesignTypographySchema.describe(
    "Heading and body fonts. Use widely-available web fonts (e.g. Inter, Poppins, Georgia).",
  ),
  interfaces: z
    .array(InterfaceSummarySchema)
    .min(1, "At least one interface must be planned")
    .max(6, "Keep the design to at most 6 interfaces")
    .describe(
      "The screens you will design next, in order. Choose the right number (typically 2-5); every screen should earn its place.",
    ),
});

const DESCRIPTION = `Commit to the app's global design system before generating any screens.

This locks in the app name, a design direction, the full color palette, the typography, and the list of interfaces (screens) you will design. It is shown to the user as a card and drives the rest of the design flow.

<when_to_use>
Call this ONCE, after you've gathered enough context (via planning_questionnaire or the user's prompt). Immediately after, proceed to call design_interface for each screen — you do NOT need to wait for approval.
</when_to_use>

<guidelines>
- palette: primary, secondary, accent, background, surface, and text are required (muted optional). Use hex codes with good contrast in mind.
- typography: pick a heading font and a body font that fit the design direction; only real, browser-renderable fonts.
- interfaces: list the screens in the order you'll design them. Give each a short name and a one-line purpose.
</guidelines>

<example>
{
  "app_name": "FreshBite",
  "user_prompt": "A restaurant website with online ordering",
  "design_direction": "Warm and appetizing with a modern, editorial feel and generous food photography.",
  "palette": {
    "primary": "#E85D04", "secondary": "#6A040F", "accent": "#FFBA08",
    "background": "#FFFDF9", "surface": "#FFFFFF", "text": "#1B1B1B", "muted": "#8A8A8A"
  },
  "typography": { "headingFont": "Poppins", "bodyFont": "Inter", "baseSize": 16 },
  "interfaces": [
    { "name": "Landing page", "purpose": "Sell the vibe and push visitors to start an order" },
    { "name": "Menu", "purpose": "Browse dishes and add items to the cart" },
    { "name": "Checkout", "purpose": "Review the order and pay" }
  ]
}
</example>`;

export const writeDesignBriefTool: ToolDefinition<
  z.infer<typeof writeDesignBriefSchema>
> = {
  name: "write_design_brief",
  description: DESCRIPTION,
  inputSchema: writeDesignBriefSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Design brief: ${args.app_name}`,

  buildXml: (args, isComplete) => {
    if (!args.app_name) return undefined;
    const appName = escapeXmlAttr(args.app_name);
    const primary = escapeXmlAttr(args.palette?.primary ?? "");
    const count = args.interfaces?.length ?? 0;
    return `<dyad-design-brief app-name="${appName}" primary-color="${primary}" interfaces="${count}" complete="${isComplete}"></dyad-design-brief>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Writing design brief: ${args.app_name}`);

    const interfaces = args.interfaces.map((i) => ({
      id: `screen_${crypto.randomUUID().slice(0, 8)}`,
      name: i.name,
      purpose: i.purpose,
    }));

    const data = DesignBriefDataSchema.parse({
      appName: args.app_name,
      userPrompt: args.user_prompt,
      designDirection: args.design_direction,
      palette: args.palette,
      typography: args.typography,
      interfaces,
    });

    safeSend(ctx.event.sender, "design:brief-update", {
      chatId: ctx.chatId,
      data,
    });

    // Mirror to `<appPath>/.dyad/designs/<chatId>.json` so the brief survives
    // reloads. Best-effort: persistence failures are logged, not thrown.
    await saveDesignBrief(ctx.appPath, ctx.chatId, data);

    const screenList = interfaces
      .map(
        (i, idx) =>
          `${idx + 1}. ${i.name}${i.purpose ? ` — ${i.purpose}` : ""}`,
      )
      .join("\n");

    return `Design brief saved for "${data.appName}".

Palette: primary ${data.palette.primary}, background ${data.palette.background}, text ${data.palette.text}.
Typography: ${data.typography.headingFont} / ${data.typography.bodyFont}.

Now design each of these ${interfaces.length} interface(s), in order, by calling design_interface once per screen:
${screenList}`;
  },
};
