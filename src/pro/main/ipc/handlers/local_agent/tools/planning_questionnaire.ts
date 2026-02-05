import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";

const logger = log.scope("planning_questionnaire");

const BaseQuestionFields = {
  id: z.string().describe("Unique identifier for this question"),
  question: z.string().describe("The question text to display to the user"),
  required: z
    .boolean()
    .optional()
    .describe("Whether this question requires an answer (defaults to true)"),
  placeholder: z
    .string()
    .optional()
    .describe("Placeholder text for text inputs"),
};

const TextQuestionSchema = z.object({
  ...BaseQuestionFields,
  type: z.literal("text"),
});

const MultipleChoiceQuestionSchema = z.object({
  ...BaseQuestionFields,
  type: z
    .enum(["radio", "checkbox"])
    .describe("radio for single choice, checkbox for multiple choice"),
  options: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(
      "Options for the question. Keep to max 3 — users can always provide a custom answer via the free-form text input.",
    ),
});

const QuestionSchema = z.union([
  TextQuestionSchema,
  MultipleChoiceQuestionSchema,
]);

const planningQuestionnaireSchema = z.object({
  title: z.string().describe("Title of this questionnaire section"),
  description: z
    .string()
    .optional()
    .describe(
      "Brief description or context for why these questions are being asked",
    ),
  questions: z
    .array(QuestionSchema)
    .min(1)
    .max(3)
    .describe("Array of 1-3 questions to present to the user"),
});

const DESCRIPTION = `
Present a structured questionnaire to gather requirements from the user during the planning phase.

**CRITICAL**: After calling this tool, you MUST STOP and wait for the user's responses before proceeding. Do NOT create a plan or take further action until the user has answered all questions. The user's responses will be sent as a follow-up message.

Use this tool to collect specific information about:
- Feature requirements and expected behavior
- Technology preferences or constraints
- Design and UX choices
- Priority decisions
- Edge cases and error handling expectations

Question Types:
- \`text\`: Free-form text input for open-ended questions
- \`radio\`: Single choice from multiple options (with additional free-form text input)
- \`checkbox\`: Multiple choice (with additional free-form text input)

**NOTE**: All question types (except pure text) include a free-form text input where users can provide custom answers or additional details. This ensures users are never limited to just the predefined options.

Best Practices:
- Ask 1-3 focused questions at a time
- Keep options to a maximum of 3 per question — users can always type a custom answer
- Users can always type a custom answer, so you don't need to cover every possible option
- Group related questions together
- Provide clear options when using radio/checkbox
- Explain why you're asking if it's not obvious

Example:
{
  "title": "Authentication Preferences",
  "description": "Help me understand your authentication requirements",
  "questions": [
    {
      "id": "auth_method",
      "type": "radio",
      "question": "Which authentication method would you prefer?",
      "options": ["Email/Password", "OAuth (Google, GitHub)", "Magic Link"],
      "required": true
    }
  ]
}
`;

export const planningQuestionnaireTool: ToolDefinition<
  z.infer<typeof planningQuestionnaireSchema>
> = {
  name: "planning_questionnaire",
  description: DESCRIPTION,
  inputSchema: planningQuestionnaireSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) =>
    `Questionnaire: ${args.title} (${args.questions.length} questions)`,

  execute: async (args, ctx: AgentContext) => {
    logger.log(
      `Presenting questionnaire: ${args.title} (${args.questions.length} questions)`,
    );

    safeSend(ctx.event.sender, "plan:questionnaire", {
      chatId: ctx.chatId,
      title: args.title,
      description: args.description,
      questions: args.questions,
    });

    return `Questionnaire "${args.title}" presented to the user. STOP HERE and wait for the user to respond. Do NOT create a plan or continue until you receive the user's answers in a follow-up message.`;
  },
};
