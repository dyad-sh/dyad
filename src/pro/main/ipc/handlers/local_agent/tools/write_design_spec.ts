import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";

const logger = log.scope("write_design_spec");

// Describing schema for the model. Structurally matches DesignSpecSchema in
// src/ipc/types/design.ts — keep the two in sync.
const designSpecSchema = z.object({
  title: z
    .string()
    .describe("Short title for the app's design (e.g. the app name)"),
  summary: z
    .string()
    .optional()
    .describe("One or two sentences describing the overall look and feel"),
  designSystem: z
    .object({
      mood: z
        .string()
        .describe(
          "The overall mood / adjectives, e.g. 'calm, minimal, trustworthy'",
        ),
      colors: z
        .array(
          z.object({
            name: z
              .string()
              .describe("Role of the color, e.g. 'Primary', 'Background'"),
            hex: z.string().describe("Hex value, e.g. '#4F46E5'"),
          }),
        )
        .describe("The color palette (4-8 colors with roles and hex values)"),
      typography: z
        .object({
          heading: z
            .string()
            .describe("Heading typeface + notable weights/sizes"),
          body: z.string().describe("Body typeface + notable weights/sizes"),
          notes: z.string().optional().describe("Any extra typography notes"),
        })
        .describe("Typography choices"),
      spacing: z
        .string()
        .optional()
        .describe(
          "Spacing / layout system notes (e.g. 8px grid, rounded corners)",
        ),
      notes: z.string().optional().describe("Any other design-system notes"),
    })
    .describe("The app-wide visual system"),
  interfaces: z
    .array(
      z.object({
        id: z
          .string()
          .describe("Stable slug for the interface, e.g. 'login', 'dashboard'"),
        name: z.string().describe("Human name, e.g. 'Login screen'"),
        purpose: z
          .string()
          .describe("One line describing what this screen is for"),
        prompt: z
          .string()
          .describe(
            "The full, detailed image-generation prompt for this interface: layout, aesthetic details, media assets, and real copy — consistent with the design system.",
          ),
        copy: z
          .string()
          .optional()
          .describe("Key copy strings shown on the screen"),
        imagePath: z
          .string()
          .optional()
          .describe(
            "Relative path (under .dyad/media) of the generated image for this interface. Fill this in AFTER calling generate_image, using the path it returns. Leave empty until the image exists.",
          ),
      }),
    )
    .describe("The list of interfaces (screens) that make up the app"),
});

const DESCRIPTION = `Record or update the app's structured **design spec** and present it in the Design preview panel.

Use this in Design mode to capture:
- The **design system**: mood, color palette (with hex), typography, spacing.
- The **interfaces** (screens): for each, a stable id, name, purpose, a rich descriptive image-generation prompt (layout, aesthetics, media, copy), and — once generated — the imagePath.

### Workflow
1. First call: provide the design system + the initial list of interfaces (with prompts but no imagePath yet).
2. For each interface, call the \`generate_image\` tool with that interface's \`prompt\`. It returns a path under \`.dyad/media\`.
3. Call this tool again with the FULL spec, filling in each interface's \`imagePath\` from the generate_image result. Always send the complete spec (all interfaces) — this call replaces the stored spec.

Do NOT write or edit any app code in Design mode. This tool only records the visual design.`;

export const writeDesignSpecTool: ToolDefinition<
  z.infer<typeof designSpecSchema>
> = {
  name: "write_design_spec",
  description: DESCRIPTION,
  inputSchema: designSpecSchema,
  defaultConsent: "always",
  modifiesState: true,

  isEnabled: (ctx) => ctx.isDyadPro,

  getConsentPreview: (args) =>
    `Design: ${args.title} (${args.interfaces?.length ?? 0} interfaces)`,

  buildXml: (args, isComplete) => {
    if (!args.title) return undefined;
    const title = escapeXmlAttr(args.title);
    const count = args.interfaces?.length ?? 0;
    return `<dyad-write-design title="${title}" interfaces="${count}" complete="${isComplete}"></dyad-write-design>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(
      `Writing design spec: ${args.title} (${args.interfaces.length} interfaces)`,
    );

    safeSend(ctx.event.sender, "design:update", {
      chatId: ctx.chatId,
      spec: args,
    });

    const withImages = args.interfaces.filter((i) => i.imagePath).length;
    return `Design spec "${args.title}" saved and shown in the Design preview panel (${args.interfaces.length} interfaces, ${withImages} with generated images). ${
      withImages < args.interfaces.length
        ? "Generate images for the remaining interfaces with generate_image, then call write_design_spec again with their imagePath filled in."
        : "All interfaces have images. Let the user know they can review the design and switch to Build or Agent mode to implement it."
    }`;
  },
};
