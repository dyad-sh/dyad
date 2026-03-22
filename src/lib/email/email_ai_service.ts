/**
 * Email AI Service
 *
 * Uses the same model resolution pipeline as the chat system
 * (readSettings → getModelClient → generateText) to provide
 * triage, summarization, composition, and follow-up detection.
 */

import { generateText } from "ai";
import { readSettings } from "@/main/settings";
import { getModelClient } from "@/ipc/utils/get_model_client";
import log from "electron-log";
import type {
  EmailMessage,
  EmailTriageResult,
  EmailSummary,
  DailyDigest,
  FollowUp,
  EmailDraft,
  EmailComposeRequest,
  EmailAddress,
} from "@/types/email_types";

const logger = log.scope("email/ai");

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getModel() {
  const settings = readSettings();
  const { modelClient } = await getModelClient(
    settings.selectedModel,
    settings,
  );
  return modelClient.model;
}

function msgContext(msg: EmailMessage): string {
  const from = `${msg.from.name ?? ""} <${msg.from.address}>`;
  const to = msg.to.map((a) => a.address).join(", ");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${msg.subject}`,
    `Date: ${new Date(msg.date).toISOString()}`,
    `---`,
    msg.bodyPlain ?? msg.snippet,
  ].join("\n");
}

function parseJSON<T>(text: string, fallback: T): T {
  // Extract JSON from markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.warn("Failed to parse AI JSON response, using fallback");
    return fallback;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Triage a single message: assign priority, category, suggest actions.
 */
export async function triageMessage(
  msg: EmailMessage,
): Promise<EmailTriageResult> {
  const model = await getModel();
  const { text } = await generateText({
    model,
    maxOutputTokens: 500,
    temperature: 0.2,
    system: `You are an email triage assistant. Analyze the email and return JSON with:
{
  "priority": "urgent"|"high"|"normal"|"low",
  "category": "action_required"|"fyi"|"newsletter"|"promotional"|"social"|"finance"|"travel"|"calendar"|"uncategorized",
  "suggestedActions": ["action1","action2"],
  "followUpDate": null or ISO date string if follow-up needed,
  "reason": "brief explanation"
}
Return ONLY valid JSON, no extra text.`,
    messages: [{ role: "user", content: msgContext(msg) }],
  });

  return parseJSON<EmailTriageResult>(text, {
    priority: "normal",
    category: "uncategorized",
    suggestedActions: [],
    reason: "Could not triage",
  });
}

/**
 * Summarize a single message or thread.
 */
export async function summarizeMessage(
  messages: EmailMessage[],
): Promise<EmailSummary> {
  const model = await getModel();
  const conversation = messages.map(msgContext).join("\n\n===\n\n");

  const { text } = await generateText({
    model,
    maxOutputTokens: 800,
    temperature: 0.3,
    system: `You are an email summarization assistant. Summarize the email(s) and return JSON:
{
  "summary": "2-3 sentence summary",
  "keyPoints": ["point1","point2"],
  "actionItems": ["item1","item2"]
}
Return ONLY valid JSON.`,
    messages: [{ role: "user", content: conversation }],
  });

  return parseJSON<EmailSummary>(text, {
    summary: "Could not summarize.",
    keyPoints: [],
    actionItems: [],
  });
}

/**
 * Compose or reply to an email given natural language instructions.
 */
export async function composeEmail(
  request: EmailComposeRequest,
  fromAddress: EmailAddress,
): Promise<EmailDraft> {
  const model = await getModel();

  let contextBlock = "";
  if (request.context?.threadMessages?.length) {
    contextBlock =
      "Previous messages in thread:\n" +
      request.context.threadMessages.map(msgContext).join("\n\n===\n\n") +
      "\n\n";
  }

  const toneInstruction = request.context?.tone
    ? `Use a ${request.context.tone} tone.`
    : "";

  const { text } = await generateText({
    model,
    maxOutputTokens: 1500,
    temperature: 0.7,
    system: `You are an email composition assistant. Write an email based on the user's instructions.
${toneInstruction}
Return JSON:
{
  "to": [{"name":"optional","address":"email@example.com"}],
  "cc": [],
  "bcc": [],
  "subject": "subject line",
  "body": "plain text body",
  "bodyHtml": "<html>body</html>"
}
Return ONLY valid JSON.`,
    messages: [
      {
        role: "user",
        content: `${contextBlock}Instructions: ${request.instruction}`,
      },
    ],
  });

  const parsed = parseJSON<{
    to: EmailAddress[];
    cc: EmailAddress[];
    bcc: EmailAddress[];
    subject: string;
    body: string;
    bodyHtml?: string;
  }>(text, {
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    body: "",
  });

  return {
    accountId: "",
    to: parsed.to,
    cc: parsed.cc,
    bcc: parsed.bcc,
    subject: parsed.subject,
    body: parsed.body,
    bodyHtml: parsed.bodyHtml,
    inReplyTo: request.context?.replyToMessageId?.toString(),
    aiGenerated: true,
  };
}

/**
 * Adjust the tone of an existing draft.
 */
export async function adjustTone(
  draft: EmailDraft,
  tone: "formal" | "casual" | "friendly" | "urgent",
): Promise<EmailDraft> {
  const model = await getModel();

  const { text } = await generateText({
    model,
    maxOutputTokens: 1500,
    temperature: 0.5,
    system: `Rewrite the email body in a ${tone} tone. Keep the same meaning and information.
Return JSON:
{
  "body": "plain text rewrite",
  "bodyHtml": "<html>rewrite</html>"
}
Return ONLY valid JSON.`,
    messages: [
      {
        role: "user",
        content: `Subject: ${draft.subject}\n\n${draft.body}`,
      },
    ],
  });

  const parsed = parseJSON<{ body: string; bodyHtml?: string }>(text, {
    body: draft.body,
  });

  return { ...draft, body: parsed.body, bodyHtml: parsed.bodyHtml };
}

/**
 * Detect follow-up commitments in an email.
 */
export async function detectFollowUps(
  msg: EmailMessage,
): Promise<FollowUp[]> {
  const model = await getModel();

  const { text } = await generateText({
    model,
    maxOutputTokens: 600,
    temperature: 0.2,
    system: `Analyze the email for follow-up commitments (promises to respond, deadlines, action items).
Return a JSON array:
[{
  "commitment": "what was promised",
  "dueDate": null or ISO date string,
  "parties": [{"name":"optional","address":"email"}]
}]
Return ONLY valid JSON array. Return [] if no follow-ups detected.`,
    messages: [{ role: "user", content: msgContext(msg) }],
  });

  const parsed = parseJSON<
    Array<{
      commitment: string;
      dueDate?: string | null;
      parties: EmailAddress[];
    }>
  >(text, []);

  return parsed.map((f) => ({
    messageId: msg.id,
    subject: msg.subject,
    commitment: f.commitment,
    dueDate: f.dueDate ? new Date(f.dueDate).getTime() : undefined,
    parties: f.parties,
    status: "pending" as const,
  }));
}

/**
 * Generate a daily digest summary from unread messages.
 */
export async function generateDailyDigest(
  messages: EmailMessage[],
): Promise<DailyDigest> {
  const model = await getModel();

  const urgent = messages.filter((m) => m.priority === "urgent");
  const actionRequired = messages.filter(
    (m) => m.aiCategory === "action_required",
  );
  const fyis = messages.filter((m) => m.aiCategory === "fyi");
  const newsletters = messages.filter((m) => m.aiCategory === "newsletter");

  const preview = messages
    .slice(0, 30)
    .map(
      (m) =>
        `[${m.priority ?? "normal"}] ${m.from.address}: ${m.subject} - ${m.snippet.slice(0, 100)}`,
    )
    .join("\n");

  const { text } = await generateText({
    model,
    maxOutputTokens: 800,
    temperature: 0.4,
    system: `Create a concise daily email digest summary. Return JSON:
{
  "summary": "2-3 sentence overview of today's emails",
  "topActionItems": ["item1","item2","item3"]
}
Return ONLY valid JSON.`,
    messages: [
      {
        role: "user",
        content: `${messages.length} unread emails today:\n${preview}`,
      },
    ],
  });

  const parsed = parseJSON<{ summary: string; topActionItems: string[] }>(
    text,
    {
      summary: `You have ${messages.length} unread emails.`,
      topActionItems: [],
    },
  );

  return {
    date: Date.now(),
    totalUnread: messages.length,
    urgent,
    actionRequired,
    fyis,
    newsletters,
    summary: parsed.summary,
    topActionItems: parsed.topActionItems,
  };
}

/**
 * Smart reply — generate a few reply options for a message.
 */
export async function generateSmartReplies(
  msg: EmailMessage,
): Promise<string[]> {
  const model = await getModel();

  const { text } = await generateText({
    model,
    maxOutputTokens: 600,
    temperature: 0.7,
    system: `Suggest 3 short reply options for this email.
Return JSON array of strings: ["reply1","reply2","reply3"]
Return ONLY valid JSON array.`,
    messages: [{ role: "user", content: msgContext(msg) }],
  });

  return parseJSON<string[]>(text, []);
}
