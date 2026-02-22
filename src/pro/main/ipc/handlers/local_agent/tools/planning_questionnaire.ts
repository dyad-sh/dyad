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

const logger = log.scope("planning_questionnaire");

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

const planningQuestionnaireSchema = z.object({
  questions: z
    .array(QuestionSchema)
    .min(1, "questions array must not be empty")
    .max(3, "questions array must have at most 3 questions")
    .describe("A non empty array of 1-3 questions to present to the user"),
});

const DESCRIPTION = `Present a structured questionnaire to gather requirements from the user. The tool displays questions in the UI and waits for the user's responses, returning them as the tool result.

<when_to_use>
Use this tool when:
- The user wants to create a NEW app or project
- The request is vague or open-ended
- There are multiple reasonable interpretations
Skip when the request is a specific, concrete change.
</when_to_use>

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
Reasoning: The user asked to "build me a todo app". I need to clarify the tech stack and key features. I'll use radio for single-choice and checkbox for multi-choice.

{
  "questions": [
    {
      "type": "radio",
      "question": "What visual style do you prefer?",
      "options": ["Minimal & clean", "Colorful & playful", "Dark & modern"]
    },
    {
      "type": "checkbox",
      "question": "Which features do you want?",
      "options": ["Due dates", "Categories/tags", "Priority levels"]
    }
  ]
}
</correct_example>

<incorrect_examples>
WRONG — Empty questions array:
{ "questions": [] }

WRONG — options on text type:
{ "type": "text", "question": "...", "options": ["a"] }

WRONG — Empty options array:
{ "type": "radio", "question": "...", "options": [] }

WRONG — Missing options for radio:
{ "type": "radio", "question": "..." }

WRONG — More than 3 questions or more than 3 options

WRONG — Array with empty object (missing required "question" and "type" fields):
{ "questions": [{}] }
</incorrect_examples>`;

export const planningQuestionnaireTool: ToolDefinition<
  z.infer<typeof planningQuestionnaireSchema>
> = {
  name: "planning_questionnaire",
  description: DESCRIPTION,
  inputSchema: planningQuestionnaireSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) =>
    `Questionnaire (${args.questions.length} questions)`,

  execute: async (args, ctx: AgentContext) => {
    const requestId = `questionnaire:${crypto.randomUUID()}`;

    // Auto-generate missing IDs
    const questions = args.questions.map((q) => ({
      ...q,
      id: q.id || `q_${crypto.randomUUID().slice(0, 8)}`,
    }));

    logger.log(
      `Presenting questionnaire (${questions.length} questions), requestId: ${requestId}`,
    );

    safeSend(ctx.event.sender, "plan:questionnaire", {
      chatId: ctx.chatId,
      requestId,
      questions,
    });

    const answers = await waitForQuestionnaireResponse(requestId, ctx.chatId);

    if (!answers) {
      return "The user dismissed the questionnaire without answering. Ask them how they'd like to proceed, or try asking questions in regular chat text.";
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
