/**
 * Email Agent Tools
 *
 * Exposes the JoyCreate email subsystem to the local agent so it can
 * search, read, triage, summarize, draft replies, archive, and schedule
 * follow-ups across any configured email account.
 *
 * Each tool resolves the account by `accountId` if provided, otherwise
 * uses the default/first configured account.
 */

import { z } from "zod";
import { eq, and, desc, like } from "drizzle-orm";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { getDb } from "@/db";
import {
  emailAccounts,
  emailMessages,
  emailDrafts,
} from "@/db/schema";
import { getProvider } from "@/lib/email/email_provider_factory";
import {
  triageMessage as aiTriageMessage,
  summarizeMessage as aiSummarizeMessage,
  composeEmail as aiComposeEmail,
} from "@/lib/email/email_ai_service";
import type {
  EmailProviderType,
  EmailAccountConfig,
  EmailMessage,
} from "@/types/email_types";

const logger = log.scope("email_agent_tools");

// ─── Shared helpers ─────────────────────────────────────────────────────────

function resolveAccount(accountId?: string): any {
  const db = getDb();
  if (accountId) {
    const acct = db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId))
      .get();
    if (!acct) throw new Error(`Email account ${accountId} not found`);
    return acct;
  }
  const all = db.select().from(emailAccounts).all();
  if (!all || all.length === 0) {
    throw new Error(
      "No email accounts configured. Add one in JoyCreate Email Hub settings.",
    );
  }
  return all.find((a: any) => a.isDefault) ?? all[0];
}

function summarizeMessageRow(m: any): string {
  const fromAddr = (m.from as { name?: string; address: string } | null)?.address ?? "?";
  const date = new Date(m.date).toISOString().slice(0, 16).replace("T", " ");
  const flags = [
    m.isRead ? "" : "UNREAD",
    m.isStarred ? "★" : "",
    m.priority && m.priority !== "normal" ? m.priority.toUpperCase() : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `[#${m.id}] ${date} <${fromAddr}> ${m.subject ?? "(no subject)"} ${flags ? `(${flags})` : ""}`;
}

// ─── 1. email_search ────────────────────────────────────────────────────────

const searchSchema = z.object({
  query: z.string().optional().describe("Free-text query matching subject"),
  folder: z.string().optional().describe("Folder name (default: inbox)"),
  isUnread: z.boolean().optional().describe("Only unread messages"),
  limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
  accountId: z.string().optional(),
});

export const emailSearchTool: ToolDefinition<z.infer<typeof searchSchema>> = {
  name: "email_search",
  description:
    "Search the user's local email cache by subject text, folder, and read status. Use this to find specific messages before reading or acting on them.",
  inputSchema: searchSchema,
  defaultConsent: "always",
  getConsentPreview: (a) =>
    `Search emails${a.query ? ` for "${a.query}"` : ""}${a.isUnread ? " (unread only)" : ""}`,

  execute: async (args) => {
    const db = getDb();
    const acct = resolveAccount(args.accountId);
    const limit = args.limit ?? 20;
    const folder = args.folder ?? "INBOX";

    const conds = [
      eq(emailMessages.accountId, acct.id),
      eq(emailMessages.folder, folder),
    ];
    if (args.isUnread) conds.push(eq(emailMessages.isRead, false));
    if (args.query) conds.push(like(emailMessages.subject, `%${args.query}%`));

    const rows = db
      .select()
      .from(emailMessages)
      .where(and(...conds))
      .orderBy(desc(emailMessages.date))
      .limit(limit)
      .all();

    if (rows.length === 0) return `No matching emails in ${acct.email}/${folder}`;
    return [
      `Found ${rows.length} message(s) in ${acct.email}/${folder}:`,
      ...rows.map(summarizeMessageRow),
    ].join("\n");
  },
};

// ─── 2. email_list_unread ───────────────────────────────────────────────────

const listUnreadSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  accountId: z.string().optional(),
});

export const emailListUnreadTool: ToolDefinition<z.infer<typeof listUnreadSchema>> = {
  name: "email_list_unread",
  description:
    "List unread email messages in the user's inbox, newest first. Use to get a quick overview of what needs attention.",
  inputSchema: listUnreadSchema,
  defaultConsent: "always",
  getConsentPreview: () => "List unread inbox messages",

  execute: async (args) => {
    const db = getDb();
    const acct = resolveAccount(args.accountId);
    const limit = args.limit ?? 20;

    const rows = db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.accountId, acct.id),
          eq(emailMessages.isRead, false),
        ),
      )
      .orderBy(desc(emailMessages.date))
      .limit(limit)
      .all();

    if (rows.length === 0) return `No unread emails in ${acct.email}`;
    return [
      `${rows.length} unread message(s) in ${acct.email}:`,
      ...rows.map(summarizeMessageRow),
    ].join("\n");
  },
};

// ─── 3. email_read_message ──────────────────────────────────────────────────

const readMessageSchema = z.object({
  messageId: z.number().int().describe("Local DB id of the message (e.g. from email_search)"),
  includeHtml: z.boolean().optional(),
});

export const emailReadMessageTool: ToolDefinition<z.infer<typeof readMessageSchema>> = {
  name: "email_read_message",
  description:
    "Read the full body of a specific email message by its local id. Returns sender, recipients, subject, date, and body text.",
  inputSchema: readMessageSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Read email #${a.messageId}`,

  execute: async (args) => {
    const db = getDb();
    const m = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, args.messageId))
      .get();
    if (!m) throw new Error(`Email #${args.messageId} not found`);

    const from = (m.from as any)?.address ?? "?";
    const to = ((m.to as any[]) ?? []).map((a) => a.address).join(", ");
    const cc = ((m.cc as any[]) ?? []).map((a) => a.address).join(", ");
    const date = new Date(m.date).toISOString();
    const body = (args.includeHtml && m.bodyHtml) ? m.bodyHtml : (m.bodyPlain ?? m.snippet ?? "");

    return [
      `From:    ${from}`,
      `To:      ${to}`,
      cc ? `Cc:      ${cc}` : null,
      `Date:    ${date}`,
      `Subject: ${m.subject ?? "(no subject)"}`,
      `Folder:  ${m.folder}`,
      `Read:    ${m.isRead ? "yes" : "NO"}`,
      `---`,
      body,
    ].filter(Boolean).join("\n");
  },
};

// ─── 4. email_triage ────────────────────────────────────────────────────────

const triageSchema = z.object({
  messageId: z.number().int(),
});

export const emailTriageTool: ToolDefinition<z.infer<typeof triageSchema>> = {
  name: "email_triage",
  description:
    "AI-classify a message: priority (urgent/high/normal/low), category, suggested actions, and follow-up date. Persists the result to the local DB.",
  inputSchema: triageSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Triage email #${a.messageId}`,

  execute: async (args) => {
    const db = getDb();
    const row = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, args.messageId))
      .get();
    if (!row) throw new Error(`Email #${args.messageId} not found`);

    const result = await aiTriageMessage(row as unknown as EmailMessage);

    db.update(emailMessages)
      .set({
        priority: result.priority,
        aiCategory: result.category,
        aiFollowUpDate: result.followUpDate ? new Date(result.followUpDate) : null,
      })
      .where(eq(emailMessages.id, args.messageId))
      .run();

    return [
      `Triaged #${args.messageId}:`,
      `  priority:        ${result.priority}`,
      `  category:        ${result.category}`,
      `  suggestedActions: ${result.suggestedActions.join(", ") || "(none)"}`,
      result.followUpDate ? `  followUpDate:    ${new Date(result.followUpDate).toISOString()}` : null,
      `  reason:          ${result.reason}`,
    ].filter(Boolean).join("\n");
  },
};

// ─── 5. email_summarize_thread ──────────────────────────────────────────────

const summarizeThreadSchema = z.object({
  messageId: z.number().int().describe("Any message in the thread; the whole thread is summarized"),
});

export const emailSummarizeThreadTool: ToolDefinition<z.infer<typeof summarizeThreadSchema>> = {
  name: "email_summarize_thread",
  description:
    "Summarize an email thread (all messages sharing a threadId). Returns a 2-3 sentence summary plus key points and action items.",
  inputSchema: summarizeThreadSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Summarize thread of email #${a.messageId}`,

  execute: async (args) => {
    const db = getDb();
    const seed = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, args.messageId))
      .get();
    if (!seed) throw new Error(`Email #${args.messageId} not found`);

    const messages = seed.threadId
      ? db
          .select()
          .from(emailMessages)
          .where(eq(emailMessages.threadId, seed.threadId))
          .orderBy(emailMessages.date)
          .all()
      : [seed];

    const summary = await aiSummarizeMessage(messages as unknown as EmailMessage[]);

    return [
      `Thread summary (${messages.length} message(s)):`,
      summary.summary,
      "",
      "Key points:",
      ...summary.keyPoints.map((p) => `  • ${p}`),
      "",
      "Action items:",
      ...summary.actionItems.map((a) => `  • ${a}`),
    ].join("\n");
  },
};

// ─── 6. email_draft_reply ───────────────────────────────────────────────────

const draftReplySchema = z.object({
  messageId: z.number().int().describe("The message to reply to"),
  instruction: z
    .string()
    .describe("How to write the reply, e.g. 'politely decline and suggest next week'"),
  tone: z.enum(["formal", "casual", "friendly", "urgent"]).optional(),
});

export const emailDraftReplyTool: ToolDefinition<z.infer<typeof draftReplySchema>> = {
  name: "email_draft_reply",
  description:
    "Generate an AI-drafted reply to a message and save it as a local draft (not sent). Returns the draft id and content for review. Use email_send to actually send.",
  inputSchema: draftReplySchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Draft reply to email #${a.messageId}`,

  execute: async (args) => {
    const db = getDb();
    const original = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, args.messageId))
      .get();
    if (!original) throw new Error(`Email #${args.messageId} not found`);

    const acct = resolveAccount(original.accountId);

    const draft = await aiComposeEmail(
      {
        instruction: args.instruction,
        context: {
          tone: args.tone,
          replyToMessageId: original.id,
          threadMessages: [original as unknown as EmailMessage],
        },
      },
      { address: acct.email as string },
    );

    // Default recipient = original sender if AI didn't pick one
    if (!draft.to || draft.to.length === 0) {
      const fromAddr = (original.from as any)?.address;
      if (fromAddr) draft.to = [{ address: fromAddr }];
    }
    // Default subject = "Re: …"
    if (!draft.subject) {
      draft.subject = (original.subject ?? "").startsWith("Re:")
        ? (original.subject as string)
        : `Re: ${original.subject ?? ""}`;
    }

    const result = db
      .insert(emailDrafts)
      .values({
        accountId: acct.id,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.body,
        bodyHtml: draft.bodyHtml,
        inReplyTo: original.remoteId,
        parentMessageId: original.id,
        aiGenerated: true,
      })
      .run();

    return [
      `Draft saved (id ${result.lastInsertRowid}):`,
      `  to:      ${draft.to.map((a) => a.address).join(", ")}`,
      `  subject: ${draft.subject}`,
      `  ---`,
      draft.body,
      `  ---`,
      `Use email_send with this draft to deliver it.`,
    ].join("\n");
  },
};

// ─── 7. email_archive ───────────────────────────────────────────────────────

const archiveSchema = z.object({
  messageId: z.number().int(),
});

export const emailArchiveTool: ToolDefinition<z.infer<typeof archiveSchema>> = {
  name: "email_archive",
  description:
    "Archive an email message (move it out of the inbox into the archive folder). The message is preserved.",
  inputSchema: archiveSchema,
  defaultConsent: "ask", // destructive-ish — requires user consent by default
  getConsentPreview: (a) => `Archive email #${a.messageId}`,

  execute: async (args) => {
    const db = getDb();
    const m = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, args.messageId))
      .get();
    if (!m) throw new Error(`Email #${args.messageId} not found`);

    const acct = resolveAccount(m.accountId);
    const provider = getProvider(
      acct.id,
      acct.provider as EmailProviderType,
      acct.config as unknown as EmailAccountConfig,
    );
    if (!provider.isConnected()) await provider.connect();

    await provider.moveMessage(m.remoteId, m.folder, "archive");
    db.update(emailMessages)
      .set({ folder: "archive" })
      .where(eq(emailMessages.id, args.messageId))
      .run();

    logger.info(`Archived email #${args.messageId}`);
    return `Archived email #${args.messageId} ("${m.subject ?? ""}")`;
  },
};

// ─── 8. email_schedule_followup ─────────────────────────────────────────────

const scheduleFollowupSchema = z.object({
  messageId: z.number().int(),
  dueDate: z.string().describe("ISO 8601 date/time when the follow-up is due"),
  note: z.string().optional().describe("Optional reminder note"),
});

export const emailScheduleFollowupTool: ToolDefinition<z.infer<typeof scheduleFollowupSchema>> = {
  name: "email_schedule_followup",
  description:
    "Schedule a follow-up reminder for an email message by setting its aiFollowUpDate. The orchestrator surfaces overdue follow-ups to the user.",
  inputSchema: scheduleFollowupSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Schedule follow-up for #${a.messageId} at ${a.dueDate}`,

  execute: async (args) => {
    const db = getDb();
    const m = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, args.messageId))
      .get();
    if (!m) throw new Error(`Email #${args.messageId} not found`);

    const due = new Date(args.dueDate);
    if (Number.isNaN(due.getTime())) {
      throw new Error(`Invalid dueDate: ${args.dueDate}`);
    }

    db.update(emailMessages)
      .set({ aiFollowUpDate: due })
      .where(eq(emailMessages.id, args.messageId))
      .run();

    return `Follow-up scheduled for #${args.messageId} at ${due.toISOString()}${args.note ? ` — ${args.note}` : ""}`;
  },
};

// ─── Tool registry ──────────────────────────────────────────────────────────

export const EMAIL_AGENT_TOOLS: readonly ToolDefinition[] = [
  emailSearchTool,
  emailListUnreadTool,
  emailReadMessageTool,
  emailTriageTool,
  emailSummarizeThreadTool,
  emailDraftReplyTool,
  emailArchiveTool,
  emailScheduleFollowupTool,
];
