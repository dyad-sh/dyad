/**
 * IMAP/SMTP Email Provider
 *
 * Generic provider for any email server supporting IMAP (read) + SMTP (send).
 * Uses imapflow for IMAP, nodemailer for SMTP, and mailparser for MIME parsing.
 */

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser, type ParsedMail } from "mailparser";
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

const logger = log.scope("email/imap-smtp");

/** Map well-known IMAP special-use flags to our folder types */
function classifyFolder(
  path: string,
  specialUse?: string,
): EmailFolderType {
  const su = (specialUse ?? "").toLowerCase();
  if (su.includes("inbox") || path.toUpperCase() === "INBOX") return "inbox";
  if (su.includes("sent")) return "sent";
  if (su.includes("drafts")) return "drafts";
  if (su.includes("trash") || su.includes("bin")) return "trash";
  if (su.includes("junk") || su.includes("spam")) return "spam";
  if (su.includes("archive") || su.includes("all")) return "archive";
  if (su.includes("flagged") || su.includes("starred")) return "starred";
  return "custom";
}

function toEmailAddress(addr: {
  name?: string;
  address?: string;
}): EmailAddress {
  return { name: addr.name ?? undefined, address: addr.address ?? "" };
}

function parsedMailToMessage(
  parsed: ParsedMail,
  uid: number,
  folder: string,
  accountId: string,
  flags: Set<string>,
): EmailMessage {
  const from = parsed.from?.value?.[0];
  const to = parsed.to
    ? Array.isArray(parsed.to)
      ? parsed.to.flatMap((a) => a.value)
      : parsed.to.value
    : [];
  const cc = parsed.cc
    ? Array.isArray(parsed.cc)
      ? parsed.cc.flatMap((a) => a.value)
      : parsed.cc.value
    : [];

  const plainBody = parsed.text ?? "";
  const snippet = plainBody.slice(0, 200).replace(/\s+/g, " ").trim();

  return {
    id: 0, // assigned by DB
    accountId,
    remoteId: String(uid),
    threadId: parsed.headers.get("references")?.toString().split(/\s+/)?.[0],
    folder,
    from: from ? toEmailAddress(from) : { address: "unknown" },
    to: to.map(toEmailAddress),
    cc: cc.map(toEmailAddress),
    bcc: [],
    subject: parsed.subject ?? "(no subject)",
    bodyPlain: plainBody,
    bodyHtml: parsed.html || undefined,
    snippet,
    date: parsed.date?.getTime() ?? Date.now(),
    isRead: flags.has("\\Seen"),
    isStarred: flags.has("\\Flagged"),
    hasAttachments: (parsed.attachments?.length ?? 0) > 0,
    size: 0,
    createdAt: Date.now(),
  };
}

export class ImapSmtpProvider implements IEmailProvider {
  readonly providerId = "imap" as const;
  private imap: ImapFlow | null = null;
  private smtpTransport: nodemailer.Transporter | null = null;
  private connected = false;

  constructor(
    private readonly accountId: string,
    private readonly config: EmailAccountConfig,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    const tlsOptions = this.config.allowInsecure
      ? { rejectUnauthorized: false }
      : undefined;

    this.imap = new ImapFlow({
      host: this.config.imapHost ?? "",
      port: this.config.imapPort ?? 993,
      secure: this.config.imapTls !== false,
      auth: {
        user: this.config.username ?? "",
        pass: this.config.accessToken ?? "",
      },
      logger: false,
      tls: tlsOptions,
    });

    await this.imap.connect();

    this.smtpTransport = nodemailer.createTransport({
      host: this.config.smtpHost ?? "",
      port: this.config.smtpPort ?? 587,
      secure: this.config.smtpTls === true,
      auth: {
        user: this.config.username ?? "",
        pass: this.config.accessToken ?? "",
      },
      tls: tlsOptions,
    });

    this.connected = true;
    logger.info(`Connected to IMAP/SMTP for ${this.accountId}`);
  }

  async disconnect(): Promise<void> {
    if (this.imap) {
      await this.imap.logout().catch(() => {});
      this.imap = null;
    }
    if (this.smtpTransport) {
      this.smtpTransport.close();
      this.smtpTransport = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listFolders(): Promise<EmailFolder[]> {
    if (!this.imap) throw new Error("Not connected");
    const tree = await this.imap.list();
    return tree.map((item, idx) => ({
      id: idx,
      accountId: this.accountId,
      name: item.name,
      path: item.path,
      type: classifyFolder(item.path, item.specialUse),
      delimiter: item.delimiter ?? "/",
      unreadCount: 0,
      totalCount: 0,
    }));
  }

  async fetchMessages(
    folder: string,
    options?: { limit?: number; offset?: number; since?: Date },
  ): Promise<EmailMessage[]> {
    if (!this.imap) throw new Error("Not connected");

    const lock = await this.imap.getMailboxLock(folder);
    try {
      const messages: EmailMessage[] = [];
      const searchCriteria: Record<string, unknown> = {};
      if (options?.since) searchCriteria.since = options.since;

      const uidResults = await this.imap.search(
        Object.keys(searchCriteria).length > 0 ? searchCriteria : { all: true },
        { uid: true },
      );
      const uids = Array.isArray(uidResults) ? uidResults : [];

      const start = options?.offset ?? 0;
      const limit = options?.limit ?? 50;
      const slice = uids.slice(
        Math.max(0, uids.length - start - limit),
        uids.length - start,
      );

      if (slice.length === 0) return [];

      const range = slice.join(",");
      for await (const msg of this.imap.fetch(range, {
        uid: true,
        source: true,
        flags: true,
      })) {
        try {
          const parsed: ParsedMail = await simpleParser(msg.source!);
          messages.push(
            parsedMailToMessage(
              parsed,
              msg.uid,
              folder,
              this.accountId,
              msg.flags ?? new Set(),
            ),
          );
        } catch (err) {
          logger.warn(`Failed to parse UID ${msg.uid}: ${err}`);
        }
      }

      return messages.sort((a, b) => b.date - a.date);
    } finally {
      lock.release();
    }
  }

  async fetchMessage(
    remoteId: string,
    folder: string,
  ): Promise<EmailMessage | null> {
    if (!this.imap) throw new Error("Not connected");

    const lock = await this.imap.getMailboxLock(folder);
    try {
      const msg = await this.imap.fetchOne(remoteId, {
        uid: true,
        source: true,
        flags: true,
      });
      if (!msg) return null;
      const parsed: ParsedMail = await simpleParser(msg.source!);
      return parsedMailToMessage(
        parsed,
        msg.uid,
        folder,
        this.accountId,
        msg.flags ?? new Set(),
      );
    } finally {
      lock.release();
    }
  }

  async searchMessages(query: EmailSearchQuery): Promise<EmailMessage[]> {
    if (!this.imap) throw new Error("Not connected");

    const folder = query.folder ?? "INBOX";
    const lock = await this.imap.getMailboxLock(folder);
    try {
      const criteria: Record<string, unknown> = {};
      if (query.query) criteria.body = query.query;
      if (query.from) criteria.from = query.from;
      if (query.to) criteria.to = query.to;
      if (query.subject) criteria.subject = query.subject;
      if (query.dateAfter) criteria.since = new Date(query.dateAfter);
      if (query.dateBefore) criteria.before = new Date(query.dateBefore);
      if (query.isUnread) criteria.unseen = true;

      const uidResults = await this.imap.search(criteria, { uid: true });
      const uids = Array.isArray(uidResults) ? uidResults : [];
      const limit = query.limit ?? 50;
      const slice = uids.slice(Math.max(0, uids.length - limit));

      if (slice.length === 0) return [];

      const messages: EmailMessage[] = [];
      for await (const msg of this.imap.fetch(slice.join(","), {
        uid: true,
        source: true,
        flags: true,
      })) {
        try {
          const parsed: ParsedMail = await simpleParser(msg.source!);
          messages.push(
            parsedMailToMessage(
              parsed,
              msg.uid,
              folder,
              this.accountId,
              msg.flags ?? new Set(),
            ),
          );
        } catch {
          /* skip unparseable */
        }
      }
      return messages.sort((a, b) => b.date - a.date);
    } finally {
      lock.release();
    }
  }

  async sendMessage(
    draft: EmailDraft,
  ): Promise<{ messageId: string }> {
    if (!this.smtpTransport) throw new Error("Not connected");

    const fromAddr = (draft as EmailDraft & { from?: string }).from ?? this.config.username ?? "";
    const info = await this.smtpTransport.sendMail({
      from: fromAddr,
      to: draft.to.map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address)).join(", "),
      cc: draft.cc.map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address)).join(", ") || undefined,
      bcc: draft.bcc.map((a) => a.address).join(", ") || undefined,
      subject: draft.subject,
      text: draft.body,
      html: draft.bodyHtml ?? undefined,
      inReplyTo: draft.inReplyTo ?? undefined,
    });

    logger.info(`Sent email via SMTP: ${info.messageId}`);
    return { messageId: info.messageId };
  }

  async moveMessage(
    remoteId: string,
    fromFolder: string,
    toFolder: string,
  ): Promise<void> {
    if (!this.imap) throw new Error("Not connected");
    const lock = await this.imap.getMailboxLock(fromFolder);
    try {
      await this.imap.messageMove(remoteId, toFolder, { uid: true });
    } finally {
      lock.release();
    }
  }

  async deleteMessage(remoteId: string, folder: string): Promise<void> {
    if (!this.imap) throw new Error("Not connected");
    const lock = await this.imap.getMailboxLock(folder);
    try {
      await this.imap.messageDelete(remoteId, { uid: true });
    } finally {
      lock.release();
    }
  }

  async markRead(
    remoteId: string,
    folder: string,
    read: boolean,
  ): Promise<void> {
    if (!this.imap) throw new Error("Not connected");
    const lock = await this.imap.getMailboxLock(folder);
    try {
      if (read) {
        await this.imap.messageFlagsAdd(remoteId, ["\\Seen"], { uid: true });
      } else {
        await this.imap.messageFlagsRemove(remoteId, ["\\Seen"], {
          uid: true,
        });
      }
    } finally {
      lock.release();
    }
  }

  async markStarred(
    remoteId: string,
    folder: string,
    starred: boolean,
  ): Promise<void> {
    if (!this.imap) throw new Error("Not connected");
    const lock = await this.imap.getMailboxLock(folder);
    try {
      if (starred) {
        await this.imap.messageFlagsAdd(remoteId, ["\\Flagged"], {
          uid: true,
        });
      } else {
        await this.imap.messageFlagsRemove(remoteId, ["\\Flagged"], {
          uid: true,
        });
      }
    } finally {
      lock.release();
    }
  }

  async syncChanges(cursor?: string): Promise<{
    messages: EmailMessage[];
    deletedIds: string[];
    newCursor: string;
  }> {
    if (!this.imap) throw new Error("Not connected");

    // For IMAP, use UID-based sync: fetch messages with UID > cursor
    const lock = await this.imap.getMailboxLock("INBOX");
    try {
      const sinceUid = cursor ? Number.parseInt(cursor, 10) + 1 : 1;
      const uidResults = await this.imap.search({ uid: `${sinceUid}:*` }, { uid: true });
      const uids = Array.isArray(uidResults) ? uidResults : [];

      const messages: EmailMessage[] = [];
      if (uids.length > 0) {
        for await (const msg of this.imap.fetch(uids.join(","), {
          uid: true,
          source: true,
          flags: true,
        })) {
          try {
            const parsed: ParsedMail = await simpleParser(msg.source!);
            messages.push(
              parsedMailToMessage(
                parsed,
                msg.uid,
                "INBOX",
                this.accountId,
                msg.flags ?? new Set(),
              ),
            );
          } catch {
            /* skip */
          }
        }
      }

      const maxUid = uids.length > 0 ? Math.max(...uids) : (sinceUid - 1);
      return {
        messages,
        deletedIds: [], // IMAP expunge detection requires IDLE — handled separately
        newCursor: String(maxUid),
      };
    } finally {
      lock.release();
    }
  }

  async getCalendarEvents(
    remoteId: string,
    folder: string,
  ): Promise<CalendarEvent[]> {
    if (!this.imap) throw new Error("Not connected");

    const lock = await this.imap.getMailboxLock(folder);
    try {
      const msg = await this.imap.fetchOne(remoteId, {
        uid: true,
        source: true,
      });
      if (!msg) return [];
      const parsed: ParsedMail = await simpleParser(msg.source!);
      const events: CalendarEvent[] = [];

      for (const att of parsed.attachments ?? []) {
        if (
          att.contentType === "text/calendar" ||
          att.filename?.endsWith(".ics")
        ) {
          try {
            const ical = await import("node-ical");
            const data = ical.parseICS(att.content.toString("utf-8"));
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
                  organizer: vevent.organizer
                    ? {
                        name:
                          typeof vevent.organizer === "object"
                            ? (vevent.organizer as { cn?: string }).cn
                            : undefined,
                        address:
                          typeof vevent.organizer === "string"
                            ? vevent.organizer.replace("mailto:", "")
                            : (vevent.organizer as { val?: string }).val?.replace(
                                "mailto:",
                                "",
                              ) ?? "",
                      }
                    : undefined,
                  icsData: att.content.toString("utf-8"),
                });
              }
            }
          } catch (err) {
            logger.warn(`Failed to parse iCal attachment: ${err}`);
          }
        }
      }

      return events;
    } finally {
      lock.release();
    }
  }
}
