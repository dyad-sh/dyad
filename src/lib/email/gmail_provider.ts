/**
 * Gmail Email Provider
 *
 * Uses the Gmail REST API (googleapis) with OAuth2 for reading, sending,
 * and managing emails from Google Workspace / personal Gmail accounts.
 */

import { google, type gmail_v1 } from "googleapis";
import log from "electron-log";
import type {
  IEmailProvider,
  EmailMessage,
  EmailFolder,
  EmailDraft,
  EmailSearchQuery,
  EmailAccountConfig,
  EmailAddress,
  CalendarEvent,
  EmailFolderType,
} from "@/types/email_types";

const logger = log.scope("email/gmail");

const LABEL_TO_FOLDER: Record<string, EmailFolderType> = {
  INBOX: "inbox",
  SENT: "sent",
  DRAFT: "drafts",
  TRASH: "trash",
  SPAM: "spam",
  STARRED: "starred",
  CATEGORY_PROMOTIONS: "custom",
  CATEGORY_SOCIAL: "custom",
  CATEGORY_UPDATES: "custom",
  CATEGORY_FORUMS: "custom",
};

function parseAddress(raw: string): EmailAddress {
  const match = raw.match(/^"?([^"<]*)"?\s*<?([^>]+)>?$/);
  if (match) {
    return { name: match[1].trim() || undefined, address: match[2].trim() };
  }
  return { address: raw.trim() };
}

function parseAddressList(raw?: string | null): EmailAddress[] {
  if (!raw) return [];
  return raw.split(",").map((s) => parseAddress(s.trim()));
}

function gmailMessageToEmail(
  msg: gmail_v1.Schema$Message,
  accountId: string,
): EmailMessage {
  const headers = msg.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
    "";

  const labels = msg.labelIds ?? [];
  const folder =
    labels.includes("INBOX")
      ? "INBOX"
      : labels.includes("SENT")
        ? "SENT"
        : labels.includes("DRAFT")
          ? "DRAFT"
          : labels.includes("TRASH")
            ? "TRASH"
            : labels.includes("SPAM")
              ? "SPAM"
              : labels[0] ?? "INBOX";

  // Extract body from parts
  let bodyPlain = "";
  let bodyHtml = "";
  const extractParts = (parts?: gmail_v1.Schema$MessagePart[]) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        bodyPlain += Buffer.from(part.body.data, "base64url").toString("utf-8");
      } else if (part.mimeType === "text/html" && part.body?.data) {
        bodyHtml += Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.parts) extractParts(part.parts);
    }
  };

  // Single-part message
  if (msg.payload?.body?.data) {
    const content = Buffer.from(msg.payload.body.data, "base64url").toString(
      "utf-8",
    );
    if (msg.payload.mimeType === "text/html") bodyHtml = content;
    else bodyPlain = content;
  }
  extractParts(msg.payload?.parts);

  const hasAttachments = !!(msg.payload?.parts ?? []).some(
    (p) => p.filename && p.filename.length > 0,
  );

  return {
    id: 0,
    accountId,
    remoteId: msg.id ?? "",
    threadId: msg.threadId ?? undefined,
    folder,
    from: parseAddress(getHeader("From")),
    to: parseAddressList(getHeader("To")),
    cc: parseAddressList(getHeader("Cc")),
    bcc: parseAddressList(getHeader("Bcc")),
    subject: getHeader("Subject") || "(no subject)",
    bodyPlain: bodyPlain || undefined,
    bodyHtml: bodyHtml || undefined,
    snippet: msg.snippet ?? "",
    date: Number(msg.internalDate) || Date.now(),
    isRead: !labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    hasAttachments,
    size: msg.sizeEstimate ?? 0,
    createdAt: Date.now(),
  };
}

export class GmailProvider implements IEmailProvider {
  readonly providerId = "gmail" as const;
  private gmail: gmail_v1.Gmail | null = null;
  private connected = false;

  constructor(
    private readonly accountId: string,
    private readonly config: EmailAccountConfig,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    const auth = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
    );
    auth.setCredentials({
      access_token: this.config.accessToken,
      refresh_token: this.config.refreshToken,
      expiry_date: this.config.tokenExpiry,
    });

    // Auto-refresh
    auth.on("tokens", (tokens) => {
      if (tokens.access_token) this.config.accessToken = tokens.access_token;
      if (tokens.expiry_date) this.config.tokenExpiry = tokens.expiry_date;
    });

    this.gmail = google.gmail({ version: "v1", auth });
    this.connected = true;
    logger.info(`Connected to Gmail API for ${this.accountId}`);
  }

  async disconnect(): Promise<void> {
    this.gmail = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listFolders(): Promise<EmailFolder[]> {
    if (!this.gmail) throw new Error("Not connected");

    const res = await this.gmail.users.labels.list({ userId: "me" });
    const labels = res.data.labels ?? [];

    return labels.map((label, idx) => ({
      id: idx,
      accountId: this.accountId,
      name: label.name ?? label.id ?? "Unknown",
      path: label.id ?? "",
      type: LABEL_TO_FOLDER[label.id ?? ""] ?? "custom",
      delimiter: "/",
      unreadCount: label.messagesUnread ?? 0,
      totalCount: label.messagesTotal ?? 0,
    }));
  }

  async fetchMessages(
    folder: string,
    options?: { limit?: number; offset?: number; since?: Date },
  ): Promise<EmailMessage[]> {
    if (!this.gmail) throw new Error("Not connected");

    let q = "";
    if (options?.since) {
      q += `after:${Math.floor(options.since.getTime() / 1000)} `;
    }

    const res = await this.gmail.users.messages.list({
      userId: "me",
      labelIds: [folder],
      maxResults: options?.limit ?? 50,
      q: q.trim() || undefined,
    });

    const messageIds = res.data.messages ?? [];
    const messages: EmailMessage[] = [];

    for (const { id } of messageIds) {
      if (!id) continue;
      try {
        const full = await this.gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        messages.push(gmailMessageToEmail(full.data, this.accountId));
      } catch (err) {
        logger.warn(`Failed to fetch Gmail message ${id}: ${err}`);
      }
    }

    return messages;
  }

  async fetchMessage(
    remoteId: string,
    _folder: string,
  ): Promise<EmailMessage | null> {
    if (!this.gmail) throw new Error("Not connected");

    try {
      const res = await this.gmail.users.messages.get({
        userId: "me",
        id: remoteId,
        format: "full",
      });
      return gmailMessageToEmail(res.data, this.accountId);
    } catch {
      return null;
    }
  }

  async searchMessages(query: EmailSearchQuery): Promise<EmailMessage[]> {
    if (!this.gmail) throw new Error("Not connected");

    const parts: string[] = [];
    if (query.query) parts.push(query.query);
    if (query.from) parts.push(`from:${query.from}`);
    if (query.to) parts.push(`to:${query.to}`);
    if (query.subject) parts.push(`subject:${query.subject}`);
    if (query.dateAfter)
      parts.push(`after:${Math.floor(query.dateAfter / 1000)}`);
    if (query.dateBefore)
      parts.push(`before:${Math.floor(query.dateBefore / 1000)}`);
    if (query.hasAttachment) parts.push("has:attachment");
    if (query.isUnread) parts.push("is:unread");

    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: parts.join(" "),
      maxResults: query.limit ?? 50,
      labelIds: query.folder ? [query.folder] : undefined,
    });

    const messages: EmailMessage[] = [];
    for (const { id } of res.data.messages ?? []) {
      if (!id) continue;
      try {
        const full = await this.gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        messages.push(gmailMessageToEmail(full.data, this.accountId));
      } catch {
        /* skip */
      }
    }
    return messages;
  }

  async sendMessage(draft: EmailDraft): Promise<{ messageId: string }> {
    if (!this.gmail) throw new Error("Not connected");

    const toLine = draft.to
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", ");
    const ccLine = draft.cc
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", ");

    const headers = [
      `To: ${toLine}`,
      `Subject: ${draft.subject}`,
      ccLine ? `Cc: ${ccLine}` : "",
      draft.inReplyTo ? `In-Reply-To: ${draft.inReplyTo}` : "",
      "Content-Type: text/html; charset=utf-8",
      "",
      draft.bodyHtml ?? draft.body,
    ]
      .filter(Boolean)
      .join("\r\n");

    const encoded = Buffer.from(headers)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encoded },
    });

    logger.info(`Sent email via Gmail API: ${res.data.id}`);
    return { messageId: res.data.id ?? "" };
  }

  async moveMessage(
    remoteId: string,
    fromFolder: string,
    toFolder: string,
  ): Promise<void> {
    if (!this.gmail) throw new Error("Not connected");
    await this.gmail.users.messages.modify({
      userId: "me",
      id: remoteId,
      requestBody: {
        addLabelIds: [toFolder],
        removeLabelIds: [fromFolder],
      },
    });
  }

  async deleteMessage(remoteId: string, _folder: string): Promise<void> {
    if (!this.gmail) throw new Error("Not connected");
    await this.gmail.users.messages.trash({ userId: "me", id: remoteId });
  }

  async markRead(
    remoteId: string,
    _folder: string,
    read: boolean,
  ): Promise<void> {
    if (!this.gmail) throw new Error("Not connected");
    await this.gmail.users.messages.modify({
      userId: "me",
      id: remoteId,
      requestBody: read
        ? { removeLabelIds: ["UNREAD"] }
        : { addLabelIds: ["UNREAD"] },
    });
  }

  async markStarred(
    remoteId: string,
    _folder: string,
    starred: boolean,
  ): Promise<void> {
    if (!this.gmail) throw new Error("Not connected");
    await this.gmail.users.messages.modify({
      userId: "me",
      id: remoteId,
      requestBody: starred
        ? { addLabelIds: ["STARRED"] }
        : { removeLabelIds: ["STARRED"] },
    });
  }

  async syncChanges(cursor?: string): Promise<{
    messages: EmailMessage[];
    deletedIds: string[];
    newCursor: string;
  }> {
    if (!this.gmail) throw new Error("Not connected");

    if (!cursor) {
      // Initial sync — fetch recent inbox messages
      const msgs = await this.fetchMessages("INBOX", { limit: 100 });
      // Get current historyId
      const profile = await this.gmail.users.getProfile({ userId: "me" });
      return {
        messages: msgs,
        deletedIds: [],
        newCursor: profile.data.historyId ?? "",
      };
    }

    // Incremental — use history API
    try {
      const res = await this.gmail.users.history.list({
        userId: "me",
        startHistoryId: cursor,
        historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
      });

      const newMessages: EmailMessage[] = [];
      const deletedIds: string[] = [];

      for (const history of res.data.history ?? []) {
        for (const added of history.messagesAdded ?? []) {
          if (added.message?.id) {
            const msg = await this.fetchMessage(added.message.id, "INBOX");
            if (msg) newMessages.push(msg);
          }
        }
        for (const deleted of history.messagesDeleted ?? []) {
          if (deleted.message?.id) deletedIds.push(deleted.message.id);
        }
      }

      return {
        messages: newMessages,
        deletedIds,
        newCursor: res.data.historyId ?? cursor,
      };
    } catch (err: unknown) {
      // historyId expired — do full sync
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: number }).code === 404
      ) {
        logger.warn("Gmail historyId expired, doing full sync");
        const msgs = await this.fetchMessages("INBOX", { limit: 100 });
        const profile = await this.gmail.users.getProfile({ userId: "me" });
        return {
          messages: msgs,
          deletedIds: [],
          newCursor: profile.data.historyId ?? "",
        };
      }
      throw err;
    }
  }

  async getCalendarEvents(
    remoteId: string,
    _folder: string,
  ): Promise<CalendarEvent[]> {
    if (!this.gmail) throw new Error("Not connected");

    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: remoteId,
      format: "full",
    });

    const events: CalendarEvent[] = [];
    const parts = res.data.payload?.parts ?? [];

    for (const part of parts) {
      if (
        part.mimeType === "text/calendar" ||
        part.filename?.endsWith(".ics")
      ) {
        if (part.body?.attachmentId) {
          const attRes = await this.gmail.users.messages.attachments.get({
            userId: "me",
            messageId: remoteId,
            id: part.body.attachmentId,
          });
          if (attRes.data.data) {
            try {
              const ical = await import("node-ical");
              const content = Buffer.from(
                attRes.data.data,
                "base64url",
              ).toString("utf-8");
              const data = ical.parseICS(content);
              for (const key of Object.keys(data)) {
                const ev = data[key];
                if (ev && ev.type === "VEVENT") {
                  const vevent = ev as any;
                  events.push({
                    title: vevent.summary ?? "Untitled Event",
                    start: new Date(vevent.start as Date).getTime(),
                    end: vevent.end
                      ? new Date(vevent.end as Date).getTime()
                      : undefined,
                    location: vevent.location ?? undefined,
                    description: vevent.description ?? undefined,
                    attendees: [],
                    isAllDay: false,
                    icsData: content,
                  });
                }
              }
            } catch (err) {
              logger.warn(`Failed to parse iCal from Gmail: ${err}`);
            }
          }
        }
      }
    }

    return events;
  }
}
