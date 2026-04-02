/**
 * Email IPC Handlers
 *
 * Registers all Electron IPC handlers for the email agent system:
 * account management, message operations, AI features, agent actions, sync.
 */

import { ipcMain } from "electron";
import { db } from "@/db";
import {
  emailAccounts,
  emailMessages,
  emailDrafts,
  emailFolders,
  emailAgentActions,
} from "@/db/schema";
import { eq, and, desc, like, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getProvider, removeProvider } from "@/lib/email/email_provider_factory";
import {
  startSync,
  stopSync,
  syncNow,
  startAllSyncs,
  stopAllSyncs,
} from "@/lib/email/email_sync_service";
import {
  triageMessage,
  summarizeMessage,
  composeEmail,
  adjustTone,
  detectFollowUps,
  generateDailyDigest,
  generateSmartReplies,
} from "@/lib/email/email_ai_service";
import {
  submitAction,
  approveAction,
  rejectAction,
  getPendingActions,
} from "@/lib/email/email_agent_executor";
import {
  startOrchestrator,
  stopOrchestrator,
  getOrchestratorStatus,
  setAutoTriage,
  setAutoActions,
  updateAgentConfig,
  getRules,
  addRule,
  updateRule,
  removeRule,
} from "@/lib/email/email_orchestrator";
import type {
  AddEmailAccountPayload,
  EmailAccountConfig,
  EmailAgentConfig,
  EmailAutoRule,
  EmailComposeRequest,
  EmailProviderType,
  EmailSearchQuery,
  EmailDraft,
} from "@/types/email_types";

export function registerEmailHandlers(): void {
  // ═══════════════════════════════════════════════════════════════════════
  // ACCOUNT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle(
    "email:account:add",
    async (_, payload: AddEmailAccountPayload) => {
      const id = uuidv4();
      let usedConfig = payload.config;

      // Test connection before saving — auto-retry with insecure TLS on cert errors
      try {
        const provider = getProvider(id, payload.provider, usedConfig);
        await provider.connect();
        await provider.disconnect();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isCertError =
          msg.includes("self signed certificate") ||
          msg.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
          msg.includes("DEPTH_ZERO_SELF_SIGNED_CERT") ||
          msg.includes("CERT_HAS_EXPIRED") ||
          msg.includes("ERR_TLS_CERT_ALTNAME_INVALID") ||
          msg.includes("certificate");

        if (isCertError && !usedConfig.allowInsecure) {
          // Retry with insecure TLS
          await removeProvider(id);
          usedConfig = { ...usedConfig, allowInsecure: true };
          const retryProvider = getProvider(id, payload.provider, usedConfig);
          await retryProvider.connect();
          await retryProvider.disconnect();
        } else {
          await removeProvider(id);
          throw err;
        }
      }

      // Clean up the test provider before saving
      await removeProvider(id);

      db.insert(emailAccounts)
        .values({
          id,
          provider: payload.provider,
          displayName: payload.displayName,
          email: payload.email,
          config: usedConfig as unknown as Record<string, unknown>,
          isDefault: payload.isDefault ?? false,
        })
        .run();

      // Start syncing
      startSync(id);

      return { id };
    },
  );

  ipcMain.handle("email:account:list", async () => {
    return db.select().from(emailAccounts).all();
  });

  ipcMain.handle("email:account:get", async (_, accountId: string) => {
    return db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId))
      .get();
  });

  ipcMain.handle(
    "email:account:update",
    async (
      _,
      accountId: string,
      updates: { displayName?: string; config?: Partial<EmailAccountConfig>; isDefault?: boolean },
    ) => {
      const existing = db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, accountId))
        .get();
      if (!existing) throw new Error("Account not found");

      const mergedConfig = updates.config
        ? { ...(existing.config as Record<string, unknown>), ...updates.config }
        : undefined;

      db.update(emailAccounts)
        .set({
          ...(updates.displayName && { displayName: updates.displayName }),
          ...(mergedConfig && { config: mergedConfig }),
          ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
        })
        .where(eq(emailAccounts.id, accountId))
        .run();

      // Restart sync with new config
      stopSync(accountId);
      startSync(accountId);

      return { success: true };
    },
  );

  ipcMain.handle("email:account:remove", async (_, accountId: string) => {
    stopSync(accountId);
    await removeProvider(accountId);
    db.delete(emailAccounts).where(eq(emailAccounts.id, accountId)).run();
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FOLDERS
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle("email:folders:list", async (_, accountId: string) => {
    return db
      .select()
      .from(emailFolders)
      .where(eq(emailFolders.accountId, accountId))
      .all();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGES
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle(
    "email:messages:list",
    async (
      _,
      accountId: string,
      folder: string,
      options?: { limit?: number; offset?: number },
    ) => {
      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;

      return db
        .select()
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.accountId, accountId),
            eq(emailMessages.folder, folder),
          ),
        )
        .orderBy(desc(emailMessages.date))
        .limit(limit)
        .offset(offset)
        .all();
    },
  );

  ipcMain.handle(
    "email:messages:list-unified",
    async (_, folder: string, options?: { limit?: number; offset?: number }) => {
      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;

      return db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.folder, folder))
        .orderBy(desc(emailMessages.date))
        .limit(limit)
        .offset(offset)
        .all();
    },
  );

  ipcMain.handle("email:messages:get", async (_, messageId: number) => {
    return db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, messageId))
      .get();
  });

  ipcMain.handle(
    "email:messages:thread",
    async (_, threadId: string) => {
      return db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.threadId, threadId))
        .orderBy(emailMessages.date)
        .all();
    },
  );

  ipcMain.handle(
    "email:messages:search",
    async (_, query: EmailSearchQuery) => {
      // Local DB search
      const conditions = [
        query.folder ? eq(emailMessages.folder, query.folder) : undefined,
        query.isUnread === true ? eq(emailMessages.isRead, false) : undefined,
        query.subject
          ? like(emailMessages.subject, `%${query.subject}%`)
          : undefined,
        query.aiCategory
          ? eq(emailMessages.aiCategory, query.aiCategory)
          : undefined,
      ].filter(Boolean);

      let q = db.select().from(emailMessages);
      if (conditions.length > 0) {
        q = q.where(and(...(conditions as any))) as any;
      }

      return (q as any)
        .orderBy(desc(emailMessages.date))
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0)
        .all();
    },
  );

  ipcMain.handle(
    "email:messages:mark-read",
    async (_, messageId: number, read: boolean) => {
      const msg = db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.id, messageId))
        .get();
      if (!msg) throw new Error("Message not found");

      const acct = db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, msg.accountId))
        .get();
      if (!acct) throw new Error("Account not found");

      const provider = getProvider(
        msg.accountId,
        acct.provider as EmailProviderType,
        acct.config as unknown as EmailAccountConfig,
      );
      if (!provider.isConnected()) await provider.connect();
      await provider.markRead(msg.remoteId, msg.folder, read);

      db.update(emailMessages)
        .set({ isRead: read })
        .where(eq(emailMessages.id, messageId))
        .run();
    },
  );

  ipcMain.handle(
    "email:messages:mark-starred",
    async (_, messageId: number, starred: boolean) => {
      const msg = db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.id, messageId))
        .get();
      if (!msg) throw new Error("Message not found");

      const acct = db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, msg.accountId))
        .get();
      if (!acct) throw new Error("Account not found");

      const provider = getProvider(
        msg.accountId,
        acct.provider as EmailProviderType,
        acct.config as unknown as EmailAccountConfig,
      );
      if (!provider.isConnected()) await provider.connect();
      await provider.markStarred(msg.remoteId, msg.folder, starred);

      db.update(emailMessages)
        .set({ isStarred: starred })
        .where(eq(emailMessages.id, messageId))
        .run();
    },
  );

  ipcMain.handle(
    "email:messages:move",
    async (_, messageId: number, toFolder: string) => {
      const msg = db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.id, messageId))
        .get();
      if (!msg) throw new Error("Message not found");

      const acct = db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, msg.accountId))
        .get();
      if (!acct) throw new Error("Account not found");

      const provider = getProvider(
        msg.accountId,
        acct.provider as EmailProviderType,
        acct.config as unknown as EmailAccountConfig,
      );
      if (!provider.isConnected()) await provider.connect();
      await provider.moveMessage(msg.remoteId, msg.folder, toFolder);

      db.update(emailMessages)
        .set({ folder: toFolder })
        .where(eq(emailMessages.id, messageId))
        .run();
    },
  );

  ipcMain.handle("email:messages:delete", async (_, messageId: number) => {
    const msg = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, messageId))
      .get();
    if (!msg) throw new Error("Message not found");

    const acct = db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, msg.accountId))
      .get();
    if (!acct) throw new Error("Account not found");

    const provider = getProvider(
      msg.accountId,
      acct.provider as EmailProviderType,
      acct.config as unknown as EmailAccountConfig,
    );
    if (!provider.isConnected()) await provider.connect();
    await provider.deleteMessage(msg.remoteId, msg.folder);

    db.delete(emailMessages)
      .where(eq(emailMessages.id, messageId))
      .run();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEND / DRAFTS
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle(
    "email:send",
    async (_, accountId: string, draft: EmailDraft) => {
      const acct = db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, accountId))
        .get();
      if (!acct) throw new Error("Account not found");

      const provider = getProvider(
        accountId,
        acct.provider as EmailProviderType,
        acct.config as unknown as EmailAccountConfig,
      );
      if (!provider.isConnected()) await provider.connect();

      return provider.sendMessage({ ...draft, accountId });
    },
  );

  ipcMain.handle(
    "email:drafts:save",
    async (_, draft: EmailDraft) => {
      if (draft.id) {
        db.update(emailDrafts)
          .set({
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            body: draft.body,
            bodyHtml: draft.bodyHtml,
            inReplyTo: draft.inReplyTo,
            aiGenerated: draft.aiGenerated,
            updatedAt: new Date(),
          })
          .where(eq(emailDrafts.id, draft.id))
          .run();
        return { id: draft.id };
      }

      const result = db
        .insert(emailDrafts)
        .values({
          accountId: draft.accountId,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
          bodyHtml: draft.bodyHtml,
          inReplyTo: draft.inReplyTo,
          aiGenerated: draft.aiGenerated,
        })
        .returning({ id: emailDrafts.id })
        .get();

      return { id: result.id };
    },
  );

  ipcMain.handle("email:drafts:list", async (_, accountId: string) => {
    return db
      .select()
      .from(emailDrafts)
      .where(eq(emailDrafts.accountId, accountId))
      .orderBy(desc(emailDrafts.updatedAt))
      .all();
  });

  ipcMain.handle("email:drafts:delete", async (_, draftId: number) => {
    db.delete(emailDrafts).where(eq(emailDrafts.id, draftId)).run();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AI FEATURES
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle("email:ai:triage", async (_, messageId: number) => {
    const msg = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, messageId))
      .get();
    if (!msg) throw new Error("Message not found");

    const result = await triageMessage(msg as any);

    // Persist AI enrichment
    db.update(emailMessages)
      .set({
        priority: result.priority,
        aiCategory: result.category,
        aiFollowUpDate: result.followUpDate
          ? new Date(result.followUpDate)
          : null,
      })
      .where(eq(emailMessages.id, messageId))
      .run();

    return result;
  });

  ipcMain.handle(
    "email:ai:triage-batch",
    async (_, messageIds: number[]) => {
      const results = [];
      for (const id of messageIds) {
        try {
          const msg = db
            .select()
            .from(emailMessages)
            .where(eq(emailMessages.id, id))
            .get();
          if (!msg) continue;

          const result = await triageMessage(msg as any);

          db.update(emailMessages)
            .set({
              priority: result.priority,
              aiCategory: result.category,
              aiFollowUpDate: result.followUpDate
                ? new Date(result.followUpDate)
                : null,
            })
            .where(eq(emailMessages.id, id))
            .run();

          results.push({ messageId: id, ...result });
        } catch (err) {
          results.push({
            messageId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return results;
    },
  );

  ipcMain.handle(
    "email:ai:summarize",
    async (_, messageIds: number[]) => {
      const msgs = messageIds
        .map((id) =>
          db.select().from(emailMessages).where(eq(emailMessages.id, id)).get(),
        )
        .filter(Boolean);

      if (msgs.length === 0) throw new Error("No messages found");

      const result = await summarizeMessage(msgs as any);

      // Persist summary on first message
      if (msgs[0]) {
        db.update(emailMessages)
          .set({ aiSummary: result.summary })
          .where(eq(emailMessages.id, msgs[0].id))
          .run();
      }

      return result;
    },
  );

  ipcMain.handle(
    "email:ai:compose",
    async (_, accountId: string, request: EmailComposeRequest) => {
      const acct = db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, accountId))
        .get();
      if (!acct) throw new Error("Account not found");

      const draft = await composeEmail(request, {
        address: acct.email,
        name: acct.displayName,
      });
      draft.accountId = accountId;
      return draft;
    },
  );

  ipcMain.handle(
    "email:ai:adjust-tone",
    async (_, draft: EmailDraft, tone: "formal" | "casual" | "friendly" | "urgent") => {
      return adjustTone(draft, tone);
    },
  );

  ipcMain.handle(
    "email:ai:smart-replies",
    async (_, messageId: number) => {
      const msg = db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.id, messageId))
        .get();
      if (!msg) throw new Error("Message not found");

      return generateSmartReplies(msg as any);
    },
  );

  ipcMain.handle(
    "email:ai:follow-ups",
    async (_, messageId: number) => {
      const msg = db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.id, messageId))
        .get();
      if (!msg) throw new Error("Message not found");

      return detectFollowUps(msg as any);
    },
  );

  ipcMain.handle("email:ai:daily-digest", async () => {
    // Grab today's unread messages across all accounts
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const msgs = db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.isRead, false))
      .orderBy(desc(emailMessages.date))
      .limit(200)
      .all();

    return generateDailyDigest(msgs as any);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AGENT ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle(
    "email:agent:submit",
    async (_, action: any, config: EmailAgentConfig) => {
      return submitAction(action, config);
    },
  );

  ipcMain.handle("email:agent:approve", async (_, actionId: number) => {
    await approveAction(actionId);
  });

  ipcMain.handle("email:agent:reject", async (_, actionId: number) => {
    rejectAction(actionId);
  });

  ipcMain.handle(
    "email:agent:pending",
    async (_, accountId: string) => {
      return getPendingActions(accountId);
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SYNC
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle("email:sync:now", async (_, accountId: string) => {
    return syncNow(accountId);
  });

  ipcMain.handle("email:sync:start-all", async () => {
    startAllSyncs();
  });

  ipcMain.handle("email:sync:stop-all", async () => {
    await stopAllSyncs();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle("email:stats", async (_, accountId?: string) => {
    const conditions = accountId
      ? eq(emailMessages.accountId, accountId)
      : undefined;

    const totalResult = db
      .select({ count: sql<number>`count(*)` })
      .from(emailMessages)
      .where(conditions)
      .get();

    const unreadResult = db
      .select({ count: sql<number>`count(*)` })
      .from(emailMessages)
      .where(
        accountId
          ? and(
              eq(emailMessages.accountId, accountId),
              eq(emailMessages.isRead, false),
            )
          : eq(emailMessages.isRead, false),
      )
      .get();

    return {
      total: totalResult?.count ?? 0,
      unread: unreadResult?.count ?? 0,
    };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ORCHESTRATOR (Autonomous Email Agent)
  // ═══════════════════════════════════════════════════════════════════════

  ipcMain.handle(
    "email:orchestrator:start",
    async (_, config?: Partial<EmailAgentConfig>) => {
      startOrchestrator(config);
    },
  );

  ipcMain.handle("email:orchestrator:stop", async () => {
    stopOrchestrator();
  });

  ipcMain.handle("email:orchestrator:status", async () => {
    return getOrchestratorStatus();
  });

  ipcMain.handle(
    "email:orchestrator:set-auto-triage",
    async (_, enabled: boolean) => {
      setAutoTriage(enabled);
    },
  );

  ipcMain.handle(
    "email:orchestrator:set-auto-actions",
    async (_, enabled: boolean) => {
      setAutoActions(enabled);
    },
  );

  ipcMain.handle(
    "email:orchestrator:update-config",
    async (_, config: Partial<EmailAgentConfig>) => {
      updateAgentConfig(config);
    },
  );

  ipcMain.handle("email:orchestrator:rules:list", async () => {
    return getRules();
  });

  ipcMain.handle(
    "email:orchestrator:rules:add",
    async (_, rule: Omit<EmailAutoRule, "id" | "createdAt">) => {
      return addRule(rule);
    },
  );

  ipcMain.handle(
    "email:orchestrator:rules:update",
    async (_, ruleId: number, updates: Partial<EmailAutoRule>) => {
      const updated = updateRule(ruleId, updates);
      if (!updated) throw new Error(`Rule ${ruleId} not found`);
      return updated;
    },
  );

  ipcMain.handle(
    "email:orchestrator:rules:remove",
    async (_, ruleId: number) => {
      const removed = removeRule(ruleId);
      if (!removed) throw new Error(`Rule ${ruleId} not found`);
    },
  );
}
