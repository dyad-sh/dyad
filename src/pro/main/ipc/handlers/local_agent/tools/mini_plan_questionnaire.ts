import { z } from "zod";
import crypto from "node:crypto";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";
import { waitForQuestionnaireResponse } from "../tool_definitions";
import {
  escapeXmlAttr,
  escapeXmlContent,
} from "../../../../../../../shared/xmlEscape";

const logger = log.scope("mini_plan_questionnaire");

const QuestionSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe(
        "Unique identifier for this question (auto-generated if omitted)",
      ),
    question: z.string().describe("The question text to display to the user"),
    type: z
      .enum(["text", "radio", "checkbox"])
      .describe(
        "text for free-form input, radio for single choice, checkbox for multiple choice",
      ),
    options: z
      .array(z.string())
      .min(1)
      .max(3)
      .optional()
      .describe(
        "Options for radio/checkbox questions. Keep to max 3 — users can always provide a custom answer via the free-form text input. Omit for text questions.",
      ),
    required: z
      .boolean()
      .optional()
      .describe("Whether this question requires an answer (defaults to true)"),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder text for text inputs"),
  })
  .refine((q) => q.type === "text" || (q.options && q.options.length >= 1), {
    message: "options are required for radio and checkbox questions",
    path: ["options"],
  });

const miniPlanQuestionnaireSchema = z.object({
  questions: z
    .array(QuestionSchema)
    .min(1, "questions array must not be empty")
    .max(3, "questions array must have at most 3 questions")
    .describe("A non empty array of 1-3 questions to present to the user"),
});

const DESCRIPTION = `Present a structured questionnaire to gather mini plan preferences from the user. This tool is specifically for mini plan configuration — NOT for technical architecture or implementation details.

<when_to_use>
Use this tool when:
- You need to clarify the user's preferences for the mini plan (app name, visual style, color scheme, target audience)
- The user's prompt is vague about design preferences
Skip when the request already provides clear preferences for all mini plan fields.
</when_to_use>

<scope>
ONLY ask about mini plan fields:
- App name preferences
- Preferred visual style or color scheme
- Target audience or industry
- Design mood (minimal, playful, professional, etc.)

Do NOT ask about:
- Technical architecture, database schema, API design
- Implementation details, file structure
- Feature prioritization or scope
</scope>

<input_schema>
The tool accepts ONLY a "questions" array.

Each question object has these fields:
- "question" (string, REQUIRED): The question text shown to the user
- "type" (string, REQUIRED): One of "text", "radio", or "checkbox"
- "options" (string array, REQUIRED for radio/checkbox, OMIT for text): 1-3 predefined choices
- "id" (string, optional): Unique identifier, auto-generated if omitted
- "required" (boolean, optional): Defaults to true
- "placeholder" (string, optional): Placeholder for text inputs
</input_schema>

<correct_example>
{
  "questions": [
    {
      "type": "radio",
      "question": "What visual style do you prefer?",
      "options": ["Minimal & clean", "Bold & colorful", "Dark & modern"]
    },
    {
      "type": "text",
      "question": "What is the primary color you'd like for the app?",
      "placeholder": "e.g., blue, #3B82F6"
    }
  ]
}
</correct_example>`;

export const miniPlanQuestionnaireTool: ToolDefinition<
  z.infer<typeof miniPlanQuestionnaireSchema>
> = {
  name: "mini_plan_questionnaire",
  description: DESCRIPTION,
  inputSchema: miniPlanQuestionnaireSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) =>
    `Mini Plan Questionnaire (${args.questions.length} questions)`,

  execute: async (args, ctx: AgentContext) => {
    const requestId = `questionnaire:${crypto.randomUUID()}`;

    // Auto-generate missing IDs
    const questions = args.questions.map((q) => ({
      ...q,
      id: q.id || `q_${crypto.randomUUID().slice(0, 8)}`,
    }));

    logger.log(
      `Presenting mini plan questionnaire (${questions.length} questions), requestId: ${requestId}`,
    );

    // Reuse the existing questionnaire UI channel
    safeSend(ctx.event.sender, "plan:questionnaire", {
      chatId: ctx.chatId,
      requestId,
      questions,
    });

    const answers = await waitForQuestionnaireResponse(requestId, ctx.chatId);

    if (!answers) {
      return "The user dismissed the questionnaire without answering. Proceed with reasonable defaults for the mini plan.";
    }

    const formattedAnswers = questions
      .map((q) => {
        const answer = answers[q.id] || "(no answer)";
        return `**${q.question}**\n${answer}`;
      })
      .join("\n\n");

    // Build XML with questions and answers for the chat UI
    const qaEntries = questions
      .map((q) => {
        const answer = answers[q.id] || "(no answer)";
        return `<qa question="${escapeXmlAttr(q.question)}" type="${escapeXmlAttr(q.type)}">${escapeXmlContent(answer)}</qa>`;
      })
      .join("\n");

    ctx.onXmlComplete(
      `<dyad-questionnaire count="${questions.length}">\n${qaEntries}\n</dyad-questionnaire>`,
    );

    return `User responses:\n\n${formattedAnswers}`;
  },
};
