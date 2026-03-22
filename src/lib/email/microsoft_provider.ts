/**
 * Microsoft (Outlook/Office 365) Email Provider
 *
 * Uses Microsoft Graph API with OAuth2 for reading, sending,
 * and managing emails from Microsoft accounts.
 */

import { Client } from "@microsoft/microsoft-graph-client";
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

const logger = log.scope("email/microsoft");

const WELL_KNOWN_FOLDERS: Record<string, EmailFolderType> = {
  inbox: "inbox",
  sentitems: "sent",
  drafts: "drafts",
  deleteditems: "trash",
  junkemail: "spam",
  archive: "archive",
};

function graphRecipientToAddress(
  r: { emailAddress?: { name?: string; address?: string } },
): EmailAddress {
  return {
    name: r.emailAddress?.name ?? undefined,
    address: r.emailAddress?.address ?? "",
  };
}

function graphMessageToEmail(
  msg: Record<string, unknown>,
  accountId: string,
  folder: string,
): EmailMessage {
  const from = msg.from as
    | { emailAddress?: { name?: string; address?: string } }
    | undefined;
  const toRecipients = (msg.toRecipients as Array<{ emailAddress?: { name?: string; address?: string } }>) ?? [];
  const ccRecipients = (msg.ccRecipients as Array<{ emailAddress?: { name?: string; address?: string } }>) ?? [];
  const bccRecipients = (msg.bccRecipients as Array<{ emailAddress?: { name?: string; address?: string } }>) ?? [];

  const body = msg.body as { contentType?: string; content?: string } | undefined;
  const bodyPlain =
    body?.contentType === "text" ? body.content ?? "" : undefined;
  const bodyHtml =
    body?.contentType === "html" ? body.content ?? "" : undefined;

  return {
    id: 0,
    accountId,
    remoteId: (msg.id as string) ?? "",
    threadId: (msg.conversationId as string) ?? undefined,
    folder,
    from: from ? graphRecipientToAddress(from) : { address: "" },
    to: toRecipients.map(graphRecipientToAddress),
    cc: ccRecipients.map(graphRecipientToAddress),
    bcc: bccRecipients.map(graphRecipientToAddress),
    subject: (msg.subject as string) ?? "(no subject)",
    bodyPlain: bodyPlain ?? undefined,
    bodyHtml: bodyHtml ?? undefined,
    snippet: (msg.bodyPreview as string) ?? "",
    date: msg.receivedDateTime
      ? new Date(msg.receivedDateTime as string).getTime()
      : Date.now(),
    isRead: (msg.isRead as boolean) ?? false,
    isStarred: (msg.flag as { flagStatus?: string })?.flagStatus === "flagged",
    hasAttachments: (msg.hasAttachments as boolean) ?? false,
    size: 0,
    createdAt: Date.now(),
  };
}

export class MicrosoftProvider implements IEmailProvider {
  readonly providerId = "microsoft" as const;
  private client: Client | null = null;
  private connected = false;

  constructor(
    private readonly accountId: string,
    private readonly config: EmailAccountConfig,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    this.client = Client.init({
      authProvider: (done) => {
        done(null, this.config.accessToken ?? "");
      },
    });

    // Verify connectivity
    try {
      await this.client.api("/me").select("displayName").get();
    } catch (err) {
      this.client = null;
      throw new Error(`Microsoft Graph auth failed: ${err}`);
    }

    this.connected = true;
    logger.info(`Connected to Microsoft Graph for ${this.accountId}`);
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listFolders(): Promise<EmailFolder[]> {
    if (!this.client) throw new Error("Not connected");

    const res = await this.client
      .api("/me/mailFolders")
      .select("id,displayName,totalItemCount,unreadItemCount")
      .top(100)
      .get();

    return (res.value ?? []).map(
      (
        f: {
          id: string;
          displayName: string;
          totalItemCount: number;
          unreadItemCount: number;
        },
        idx: number,
      ) => ({
        id: idx,
        accountId: this.accountId,
        name: f.displayName,
        path: f.id,
        type:
          WELL_KNOWN_FOLDERS[f.displayName.toLowerCase().replace(/\s/g, "")] ??
          "custom",
        delimiter: "/",
        unreadCount: f.unreadItemCount ?? 0,
        totalCount: f.totalItemCount ?? 0,
      }),
    );
  }

  async fetchMessages(
    folder: string,
    options?: { limit?: number; offset?: number; since?: Date },
  ): Promise<EmailMessage[]> {
    if (!this.client) throw new Error("Not connected");

    let req = this.client
      .api(`/me/mailFolders/${folder}/messages`)
      .select(
        "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,flag,hasAttachments",
      )
      .top(options?.limit ?? 50)
      .orderby("receivedDateTime desc");

    if (options?.since) {
      req = req.filter(
        `receivedDateTime ge ${options.since.toISOString()}`,
      );
    }
    if (options?.offset) {
      req = req.skip(options.offset);
    }

    const res = await req.get();
    return (res.value ?? []).map((m: Record<string, unknown>) =>
      graphMessageToEmail(m, this.accountId, folder),
    );
  }

  async fetchMessage(
    remoteId: string,
    _folder: string,
  ): Promise<EmailMessage | null> {
    if (!this.client) throw new Error("Not connected");
    try {
      const msg = await this.client
        .api(`/me/messages/${remoteId}`)
        .select(
          "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,flag,hasAttachments",
        )
        .get();
      return graphMessageToEmail(msg, this.accountId, _folder);
    } catch {
      return null;
    }
  }

  async searchMessages(query: EmailSearchQuery): Promise<EmailMessage[]> {
    if (!this.client) throw new Error("Not connected");

    const searchTerm =
      query.query ??
      [query.subject, query.from, query.to].filter(Boolean).join(" ");

    let req = this.client
      .api("/me/messages")
      .select(
        "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,flag,hasAttachments",
      )
      .top(query.limit ?? 50);

    if (searchTerm) {
      req = req.search(`"${searchTerm}"`);
    }

    const filters: string[] = [];
    if (query.dateAfter) {
      filters.push(
        `receivedDateTime ge ${new Date(query.dateAfter).toISOString()}`,
      );
    }
    if (query.dateBefore) {
      filters.push(
        `receivedDateTime le ${new Date(query.dateBefore).toISOString()}`,
      );
    }
    if (query.isUnread) {
      filters.push("isRead eq false");
    }
    if (query.hasAttachment) {
      filters.push("hasAttachments eq true");
    }
    if (filters.length > 0) {
      req = req.filter(filters.join(" and "));
    }

    const res = await req.get();
    return (res.value ?? []).map((m: Record<string, unknown>) =>
      graphMessageToEmail(m, this.accountId, query.folder ?? "INBOX"),
    );
  }

  async sendMessage(draft: EmailDraft): Promise<{ messageId: string }> {
    if (!this.client) throw new Error("Not connected");

    const message = {
      subject: draft.subject,
      body: {
        contentType: draft.bodyHtml ? "HTML" : "Text",
        content: draft.bodyHtml ?? draft.body,
      },
      toRecipients: draft.to.map((a) => ({
        emailAddress: { name: a.name, address: a.address },
      })),
      ccRecipients: draft.cc.map((a) => ({
        emailAddress: { name: a.name, address: a.address },
      })),
      bccRecipients: draft.bcc.map((a) => ({
        emailAddress: { name: a.name, address: a.address },
      })),
    };

    const res = await this.client
      .api("/me/sendMail")
      .post({ message, saveToSentItems: true });

    logger.info("Sent email via Microsoft Graph");
    return { messageId: res?.id ?? "" };
  }

  async moveMessage(
    remoteId: string,
    _fromFolder: string,
    toFolder: string,
  ): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client
      .api(`/me/messages/${remoteId}/move`)
      .post({ destinationId: toFolder });
  }

  async deleteMessage(remoteId: string, _folder: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    // Move to Deleted Items
    await this.client
      .api(`/me/messages/${remoteId}/move`)
      .post({ destinationId: "deleteditems" });
  }

  async markRead(
    remoteId: string,
    _folder: string,
    read: boolean,
  ): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client
      .api(`/me/messages/${remoteId}`)
      .patch({ isRead: read });
  }

  async markStarred(
    remoteId: string,
    _folder: string,
    starred: boolean,
  ): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client
      .api(`/me/messages/${remoteId}`)
      .patch({
        flag: { flagStatus: starred ? "flagged" : "notFlagged" },
      });
  }

  async syncChanges(cursor?: string): Promise<{
    messages: EmailMessage[];
    deletedIds: string[];
    newCursor: string;
  }> {
    if (!this.client) throw new Error("Not connected");

    // Use delta query for incremental sync
    const url = cursor || "/me/mailFolders/inbox/messages/delta?$select=id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,flag,hasAttachments&$top=100";

    const messages: EmailMessage[] = [];
    const deletedIds: string[] = [];

    try {
      const res = await this.client.api(url).get();

      for (const item of res.value ?? []) {
        if (item["@removed"]) {
          deletedIds.push(item.id);
        } else {
          messages.push(
            graphMessageToEmail(item, this.accountId, "inbox"),
          );
        }
      }

      // deltaLink is the cursor for next sync
      const newCursor = res["@odata.deltaLink"] ?? res["@odata.nextLink"] ?? cursor ?? "";

      return { messages, deletedIds, newCursor };
    } catch (err) {
      logger.warn(`Microsoft delta sync failed, doing full fetch: ${err}`);
      const msgs = await this.fetchMessages("inbox", { limit: 100 });
      return { messages: msgs, deletedIds: [], newCursor: "" };
    }
  }

  async getCalendarEvents(
    remoteId: string,
    _folder: string,
  ): Promise<CalendarEvent[]> {
    if (!this.client) throw new Error("Not connected");

    const events: CalendarEvent[] = [];

    try {
      // Get attachments for this message
      const res = await this.client
        .api(`/me/messages/${remoteId}/attachments`)
        .get();

      for (const att of res.value ?? []) {
        if (
          att.contentType === "text/calendar" ||
          att.name?.endsWith(".ics")
        ) {
          try {
            const ical = await import("node-ical");
            const content = att.contentBytes
              ? Buffer.from(att.contentBytes, "base64").toString("utf-8")
              : "";
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
            logger.warn(`Failed to parse iCal from Microsoft: ${err}`);
          }
        }
      }
    } catch (err) {
      logger.warn(`Failed to fetch attachments from Microsoft: ${err}`);
    }

    return events;
  }
}
