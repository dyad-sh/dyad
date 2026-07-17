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
      "1-2 sentences stating the design THESIS: a specific position, ideally with a named influence. Not 'modern and clean' — a sentence that could describe any product is not a direction.",
    ),
  palette: DesignPaletteSchema.describe(
    "The app's color system as hex codes. Mostly neutrals, with ONE accent that lands on the primary action and little else.",
  ),
  typography: DesignTypographySchema.describe(
    "Heading and body fonts, chosen from the allowed set to serve the thesis. These are the only fonts that will render.",
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
- design_direction: state a THESIS, not a mood board. It should name a specific position and ideally a real influence ("the density of a Bloomberg terminal", "Swiss editorial, like a Müller-Brockmann poster", "the warmth of a 70s cookbook"). "Modern, clean and user-friendly" describes nothing and commits to nothing — if the sentence could describe any product, it is not a direction.
- palette: primary, secondary, accent, background, surface, and text are required (muted optional). Hex codes. Build it mostly from neutrals — near-blacks and off-whites — with ONE accent that earns its place and lands on the primary action. Pure #FFFFFF/#000000 are usually the lazy pick; a warm or cool off-tint (#FAF8F5, #0E0E10) reads as considered. Avoid purple-to-blue gradients; they are the house style of generated design.
- typography: heading and body fonts must come from the enum — those are the only fonts that will render, and the mockups spell them exactly as given here. Pick a pairing that serves the thesis rather than the safest option: Inter/Inter is right for a dense data tool and wasted on a fashion brand.
- interfaces: list the screens in the order you'll design them. Give each a short name and a one-line purpose.
</guidelines>

<example>
Note that the direction commits to a specific idea, the palette is four neutrals plus one accent, and the fonts were chosen because a light display serif is what "print cookbook" means.

{
  "app_name": "FreshBite",
  "user_prompt": "A restaurant website with online ordering",
  "design_direction": "A restaurant that behaves like a print cookbook: enormous light serif, oceans of margin, one photograph doing all the work. Ordering is treated as a quiet transaction at the end, not a storefront.",
  "palette": {
    "primary": "#1B1B1B", "secondary": "#6B6560", "accent": "#C2410C",
    "background": "#FAF8F5", "surface": "#F1EDE7", "text": "#1B1B1B", "muted": "#9A938B"
  },
  "typography": { "headingFont": "Instrument Serif", "bodyFont": "Inter Variable", "baseSize": 16 },
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
