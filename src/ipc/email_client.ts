/**
 * Email IPC Client
 *
 * Renderer-side client for all email agent operations.
 * Communicates with the main process via Electron IPC.
 */

import type { IpcRenderer } from "electron";
import type {
  AddEmailAccountPayload,
  EmailAccount,
  EmailAccountConfig,
  EmailAgentAction,
  EmailAgentConfig,
  EmailComposeRequest,
  EmailDraft,
  EmailFolder,
  EmailMessage,
  EmailSearchQuery,
  EmailSummary,
  EmailSyncEvent,
  EmailSyncResult,
  EmailTriageResult,
  DailyDigest,
  FollowUp,
} from "@/types/email_types";

export class EmailClient {
  private static instance: EmailClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  public static getInstance(): EmailClient {
    if (!EmailClient.instance) {
      EmailClient.instance = new EmailClient();
    }
    return EmailClient.instance;
  }

  // ─── Account Management ───────────────────────────────────────────

  async addAccount(
    payload: AddEmailAccountPayload,
  ): Promise<{ id: string }> {
    return this.ipcRenderer.invoke("email:account:add", payload);
  }

  async listAccounts(): Promise<EmailAccount[]> {
    return this.ipcRenderer.invoke("email:account:list");
  }

  async getAccount(accountId: string): Promise<EmailAccount | null> {
    return this.ipcRenderer.invoke("email:account:get", accountId);
  }

  async updateAccount(
    accountId: string,
    updates: {
      displayName?: string;
      config?: Partial<EmailAccountConfig>;
      isDefault?: boolean;
    },
  ): Promise<void> {
    return this.ipcRenderer.invoke("email:account:update", accountId, updates);
  }

  async removeAccount(accountId: string): Promise<void> {
    return this.ipcRenderer.invoke("email:account:remove", accountId);
  }

  // ─── Folders ──────────────────────────────────────────────────────

  async listFolders(accountId: string): Promise<EmailFolder[]> {
    return this.ipcRenderer.invoke("email:folders:list", accountId);
  }

  // ─── Messages ─────────────────────────────────────────────────────

  async listMessages(
    accountId: string,
    folder: string,
    options?: { limit?: number; offset?: number },
  ): Promise<EmailMessage[]> {
    return this.ipcRenderer.invoke(
      "email:messages:list",
      accountId,
      folder,
      options,
    );
  }

  async listUnifiedMessages(
    folder: string,
    options?: { limit?: number; offset?: number },
  ): Promise<EmailMessage[]> {
    return this.ipcRenderer.invoke(
      "email:messages:list-unified",
      folder,
      options,
    );
  }

  async getMessage(messageId: number): Promise<EmailMessage | null> {
    return this.ipcRenderer.invoke("email:messages:get", messageId);
  }

  async getThread(threadId: string): Promise<EmailMessage[]> {
    return this.ipcRenderer.invoke("email:messages:thread", threadId);
  }

  async searchMessages(query: EmailSearchQuery): Promise<EmailMessage[]> {
    return this.ipcRenderer.invoke("email:messages:search", query);
  }

  async markRead(messageId: number, read: boolean): Promise<void> {
    return this.ipcRenderer.invoke("email:messages:mark-read", messageId, read);
  }

  async markStarred(messageId: number, starred: boolean): Promise<void> {
    return this.ipcRenderer.invoke(
      "email:messages:mark-starred",
      messageId,
      starred,
    );
  }

  async moveMessage(messageId: number, toFolder: string): Promise<void> {
    return this.ipcRenderer.invoke("email:messages:move", messageId, toFolder);
  }

  async deleteMessage(messageId: number): Promise<void> {
    return this.ipcRenderer.invoke("email:messages:delete", messageId);
  }

  // ─── Send / Drafts ────────────────────────────────────────────────

  async sendEmail(
    accountId: string,
    draft: EmailDraft,
  ): Promise<{ messageId: string }> {
    return this.ipcRenderer.invoke("email:send", accountId, draft);
  }

  async saveDraft(draft: EmailDraft): Promise<{ id: number }> {
    return this.ipcRenderer.invoke("email:drafts:save", draft);
  }

  async listDrafts(accountId: string): Promise<EmailDraft[]> {
    return this.ipcRenderer.invoke("email:drafts:list", accountId);
  }

  async deleteDraft(draftId: number): Promise<void> {
    return this.ipcRenderer.invoke("email:drafts:delete", draftId);
  }

  // ─── AI Features ──────────────────────────────────────────────────

  async triageMessage(messageId: number): Promise<EmailTriageResult> {
    return this.ipcRenderer.invoke("email:ai:triage", messageId);
  }

  async triageBatch(
    messageIds: number[],
  ): Promise<Array<{ messageId: number } & Partial<EmailTriageResult>>> {
    return this.ipcRenderer.invoke("email:ai:triage-batch", messageIds);
  }

  async summarizeMessages(messageIds: number[]): Promise<EmailSummary> {
    return this.ipcRenderer.invoke("email:ai:summarize", messageIds);
  }

  async composeEmail(
    accountId: string,
    request: EmailComposeRequest,
  ): Promise<EmailDraft> {
    return this.ipcRenderer.invoke("email:ai:compose", accountId, request);
  }

  async adjustTone(
    draft: EmailDraft,
    tone: "formal" | "casual" | "friendly" | "urgent",
  ): Promise<EmailDraft> {
    return this.ipcRenderer.invoke("email:ai:adjust-tone", draft, tone);
  }

  async smartReplies(messageId: number): Promise<string[]> {
    return this.ipcRenderer.invoke("email:ai:smart-replies", messageId);
  }

  async detectFollowUps(messageId: number): Promise<FollowUp[]> {
    return this.ipcRenderer.invoke("email:ai:follow-ups", messageId);
  }

  async dailyDigest(): Promise<DailyDigest> {
    return this.ipcRenderer.invoke("email:ai:daily-digest");
  }

  // ─── Agent Actions ────────────────────────────────────────────────

  async submitAgentAction(
    action: Omit<EmailAgentAction, "id" | "status" | "createdAt">,
    config: EmailAgentConfig,
  ): Promise<EmailAgentAction> {
    return this.ipcRenderer.invoke("email:agent:submit", action, config);
  }

  async approveAction(actionId: number): Promise<void> {
    return this.ipcRenderer.invoke("email:agent:approve", actionId);
  }

  async rejectAction(actionId: number): Promise<void> {
    return this.ipcRenderer.invoke("email:agent:reject", actionId);
  }

  async getPendingActions(accountId: string): Promise<EmailAgentAction[]> {
    return this.ipcRenderer.invoke("email:agent:pending", accountId);
  }

  // ─── Sync ─────────────────────────────────────────────────────────

  async syncNow(accountId: string): Promise<EmailSyncResult> {
    return this.ipcRenderer.invoke("email:sync:now", accountId);
  }

  async startAllSyncs(): Promise<void> {
    return this.ipcRenderer.invoke("email:sync:start-all");
  }

  async stopAllSyncs(): Promise<void> {
    return this.ipcRenderer.invoke("email:sync:stop-all");
  }

  // ─── Stats ────────────────────────────────────────────────────────

  async getStats(
    accountId?: string,
  ): Promise<{ total: number; unread: number }> {
    return this.ipcRenderer.invoke("email:stats", accountId);
  }

  // ─── Events ───────────────────────────────────────────────────────

  onSyncEvent(callback: (event: EmailSyncEvent) => void): () => void {
    const handler = (_: unknown, event: EmailSyncEvent) => callback(event);
    this.ipcRenderer.on("email:sync-event", handler);
    return () => this.ipcRenderer.removeListener("email:sync-event", handler);
  }

  onPendingAction(callback: (action: EmailAgentAction) => void): () => void {
    const handler = (_: unknown, action: EmailAgentAction) => callback(action);
    this.ipcRenderer.on("email:pending-action", handler);
    return () =>
      this.ipcRenderer.removeListener("email:pending-action", handler);
  }
}
