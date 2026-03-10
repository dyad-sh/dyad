import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";

const promptSuggestionSchema = z.object({
  summary: z
    .string()
    .describe(
      "Short button label for the suggestion (under 40 characters, no double quotes)",
    ),
  prompt: z
    .string()
    .describe("The full prompt text that will be sent when the user clicks"),
});

const setPromptSuggestionsSchema = z.object({
  suggestions: z
    .array(promptSuggestionSchema)
    .min(2)
    .max(4)
    .describe("2-4 follow-up prompt suggestions for the user"),
});

export const setPromptSuggestionsTool: ToolDefinition<
  z.infer<typeof setPromptSuggestionsSchema>
> = {
  name: "set_prompt_suggestions",
  description:
    "Set follow-up prompt suggestions that appear as buttons for the user to quickly ask a related next step. Call this at the end of the turn alongside set_chat_summary.",
  inputSchema: setPromptSuggestionsSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    args.suggestions.map((s) => s.summary).join(", "),

  buildXml: (args, _isComplete) => {
    if (!args.suggestions) return undefined;
    return ``;
  },

  execute: async (args, ctx: AgentContext) => {
    if (args.suggestions && args.suggestions.length > 0) {
      ctx.promptSuggestions = args.suggestions;
    }
    return `Set ${args.suggestions.length} prompt suggestions`;
  },
};
