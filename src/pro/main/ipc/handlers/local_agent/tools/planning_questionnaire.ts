import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";

const logger = log.scope("planning_questionnaire");

const QuestionSchema = z.object({
  id: z.string().describe("Unique identifier for this question"),
  type: z
    .enum(["text", "radio", "checkbox", "select"])
    .describe(
      "Type of input: text for free-form, radio for single choice, checkbox for multiple choice, select for dropdown",
    ),
  question: z.string().describe("The question text to display to the user"),
  options: z
    .array(z.string())
    .optional()
    .describe("Options for radio, checkbox, or select question types"),
  required: z
    .boolean()
    .optional()
    .describe("Whether this question requires an answer (defaults to true)"),
  placeholder: z
    .string()
    .optional()
    .describe("Placeholder text for text inputs"),
});

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
    .max(5)
    .describe("Array of 1-5 questions to present to the user"),
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
- \`radio\`: Single choice from multiple options
- \`checkbox\`: Multiple choice (select multiple options)
- \`select\`: Dropdown selection for single choice with many options

Best Practices:
- Ask 2-4 focused questions at a time
- Group related questions together
- Provide clear options when using radio/checkbox/select
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
      "options": ["Email/Password", "OAuth (Google, GitHub)", "Magic Link", "All of the above"],
      "required": true
    },
    {
      "id": "session_duration",
      "type": "select",
      "question": "How long should user sessions last?",
      "options": ["1 hour", "24 hours", "7 days", "30 days", "Until logout"],
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

  getConsentPreview: (args) =>
    `Questionnaire: ${args.title} (${args.questions.length} questions)`,

  // No buildXml - we don't render this in the chat flow anymore.
  // Instead, we use the execute function to send an IPC event that triggers
  // the persistent UI above the chat input.

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Presenting questionnaire: ${args.title}`);

    // Send the questionnaire payload to the frontend via IPC
    safeSend(ctx.event.sender, "plan:questionnaire", {
      chatId: ctx.chatId,
      title: args.title,
      description: args.description,
      questions: args.questions,
    });

    logger.log(
      `Questionnaire "${args.title}" presented with ${args.questions.length} questions`,
    );

    return `Questionnaire "${args.title}" presented to the user. STOP HERE and wait for the user to respond. Do NOT create a plan or continue until you receive the user's answers in a follow-up message.`;
  },
};
