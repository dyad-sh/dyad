import { z } from "zod";
import { ToolDefinition, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

import addAuthentication from "@/prompts/guides/add-authentication.md?raw";
import addEmailVerification from "@/prompts/guides/add-email-verification.md?raw";
import addPasswordReset from "@/prompts/guides/add-password-reset.md?raw";

/**
 * Registry of available guides. To add a new guide, import its .md file
 * with ?raw and add an entry here.
 */
const GUIDES: Record<string, string> = {
  "add-authentication": addAuthentication,
  "add-email-verification": addEmailVerification,
  "add-password-reset": addPasswordReset,
};

const readGuideSchema = z.object({
  guide: z
    .string()
    .describe(
      "Name of the guide to read (e.g. 'add-authentication', 'add-email-verification', 'add-password-reset')",
    ),
});

export const readGuideTool: ToolDefinition<z.infer<typeof readGuideSchema>> = {
  name: "read_guide",
  description:
    "Read a detailed instruction guide. Use this when the system prompt tells you to load a guide before implementing a feature.",
  inputSchema: readGuideSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => `Read guide: ${args.guide}`,

  buildXml: (args) => {
    if (!args.guide) return undefined;
    return `<dyad-read-guide name="${escapeXmlAttr(args.guide)}"></dyad-read-guide>`;
  },

  execute: async (args) => {
    const content = GUIDES[args.guide];
    if (!content) {
      const available = Object.keys(GUIDES).join(", ");
      throw new DyadError(
        `Guide "${args.guide}" not found. Available guides: ${available}`,
        DyadErrorKind.NotFound,
      );
    }
    return content;
  },
};
