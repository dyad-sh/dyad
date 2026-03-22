/**
 * Email Agent Executor
 *
 * Executes email actions (send, reply, archive, etc.) respecting
 * the configurable trust-level system: auto → execute immediately,
 * confirm → queue for user approval, never → block.
 */

import { db } from "@/db";
import {
  emailAccounts,
  emailMessages,
  emailAgentActions,
} from "@/db/schema";
import { getProvider } from "./email_provider_factory";
import { eq, and } from "drizzle-orm";
import { BrowserWindow } from "electron";
import log from "electron-log";
import type {
  EmailAgentAction,
  EmailAgentConfig,
  EmailAgentActionType,
  EmailTrustLevel,
  EmailAccountConfig,
  EmailProviderType,
  EmailDraft,
  EmailAddress,
} from "@/types/email_types";

const logger = log.scope("email/agent");

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Submit an agent action. Depending on trust level:
 * - "auto"    → execute immediately
 * - "confirm" → queue for user approval
 * - "never"   → reject immediately
 */
export async function submitAction(
  action: Omit<EmailAgentAction, "id" | "status" | "createdAt">,
  agentConfig: EmailAgentConfig,
): Promise<EmailAgentAction> {
  const trustLevel = resolveTrustLevel(action.actionType, agentConfig);

  if (trustLevel === "never") {
    logger.info(`Blocked action ${action.actionType} (trust=never)`);
    const saved = insertAction({ ...action, trustLevel, status: "rejected" });
    return saved;
  }

  if (trustLevel === "auto") {
    const saved = insertAction({ ...action, trustLevel, status: "pending" });
    try {
      await executeAction(saved);
      markActionExecuted(saved.id!, "executed");
      saved.status = "executed";
      logger.info(`Auto-executed action ${action.actionType}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      markActionExecuted(saved.id!, "rejected", errMsg);
      saved.status = "rejected";
      saved.result = errMsg;
      logger.error(`Auto-execute failed: ${errMsg}`);
    }
    return saved;
  }

  // confirm
  const saved = insertAction({ ...action, trustLevel, status: "pending" });
  notifyPendingAction(saved);
  logger.info(`Queued action ${action.actionType} for confirmation`);
  return saved;
}

/**
 * Approve and execute a pending action.
 */
export async function approveAction(actionId: number): Promise<void> {
  const row = db
    .select()
    .from(emailAgentActions)
    .where(eq(emailAgentActions.id, actionId))
    .get();

  if (!row) throw new Error(`Action ${actionId} not found`);
  if (row.status !== "pending") {
    throw new Error(`Action ${actionId} is already ${row.status}`);
  }

  const action = rowToAction(row);

  try {
    await executeAction(action);
    markActionExecuted(actionId, "executed");
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    markActionExecuted(actionId, "rejected", errMsg);
    throw new Error(`Execution failed: ${errMsg}`);
  }
}

/**
 * Reject a pending action.
 */
export function rejectAction(actionId: number): void {
  db.update(emailAgentActions)
    .set({ status: "rejected" })
    .where(eq(emailAgentActions.id, actionId))
    .run();
}

/**
 * Get all pending actions for an account.
 */
export function getPendingActions(accountId: string): EmailAgentAction[] {
  const rows = db
    .select()
    .from(emailAgentActions)
    .where(
      and(
        eq(emailAgentActions.accountId, accountId),
        eq(emailAgentActions.status, "pending"),
      ),
    )
    .all();
  return rows.map(rowToAction);
}

// ─── Execution Logic ─────────────────────────────────────────────────────────

async function executeAction(action: EmailAgentAction): Promise<void> {
  const acctRow = db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.id, action.accountId))
    .get();

  if (!acctRow) throw new Error(`Account ${action.accountId} not found`);

  const config = acctRow.config as EmailAccountConfig;
  const provider = getProvider(
    action.accountId,
    acctRow.provider as EmailProviderType,
    config,
  );

  if (!provider.isConnected()) {
    await provider.connect();
  }

  const payload = action.payload;

  switch (action.actionType) {
    case "send":
    case "reply":
    case "forward": {
      const draft: EmailDraft = {
        accountId: action.accountId,
        to: (payload.to as EmailAddress[]) ?? [],
        cc: (payload.cc as EmailAddress[]) ?? [],
        bcc: (payload.bcc as EmailAddress[]) ?? [],
        subject: (payload.subject as string) ?? "",
        body: (payload.body as string) ?? "",
        bodyHtml: (payload.bodyHtml as string) ?? undefined,
        inReplyTo: (payload.inReplyTo as string) ?? undefined,
        aiGenerated: true,
      };
      await provider.sendMessage(draft);
      break;
    }
    case "archive": {
      const remoteId = payload.remoteId as string;
      const fromFolder = payload.fromFolder as string;
      await provider.moveMessage(remoteId, fromFolder, "archive");
      break;
    }
    case "move": {
      const remoteId = payload.remoteId as string;
      const fromFolder = payload.fromFolder as string;
      const toFolder = payload.toFolder as string;
      await provider.moveMessage(remoteId, fromFolder, toFolder);
      break;
    }
    case "delete": {
      const remoteId = payload.remoteId as string;
      const folder = payload.folder as string;
      await provider.deleteMessage(remoteId, folder);
      break;
    }
    case "mark_read": {
      const remoteId = payload.remoteId as string;
      const folder = payload.folder as string;
      const read = (payload.read as boolean) ?? true;
      await provider.markRead(remoteId, folder, read);
      break;
    }
    case "label": {
      // For label, we move to a label folder
      const remoteId = payload.remoteId as string;
      const fromFolder = payload.fromFolder as string;
      const label = payload.label as string;
      await provider.moveMessage(remoteId, fromFolder, label);
      break;
    }
    default:
      throw new Error(`Unknown action type: ${action.actionType}`);
  }
}

// ─── DB Helpers ──────────────────────────────────────────────────────────────

function insertAction(
  action: Omit<EmailAgentAction, "id" | "createdAt"> & {
    trustLevel: EmailTrustLevel;
    status: string;
  },
): EmailAgentAction {
  const result = db
    .insert(emailAgentActions)
    .values({
      accountId: action.accountId,
      actionType: action.actionType,
      targetMessageId: action.targetMessageId,
      payload: action.payload,
      trustLevel: action.trustLevel,
      status: action.status,
    })
    .returning()
    .get();

  return rowToAction(result);
}

function markActionExecuted(
  id: number,
  status: "executed" | "rejected",
  result?: string,
): void {
  db.update(emailAgentActions)
    .set({
      status,
      result: result ?? null,
      executedAt: new Date(),
    })
    .where(eq(emailAgentActions.id, id))
    .run();
}

function rowToAction(row: Record<string, unknown>): EmailAgentAction {
  return {
    id: row.id as number,
    accountId: row.accountId as string,
    actionType: row.actionType as EmailAgentActionType,
    targetMessageId: row.targetMessageId as number | undefined,
    payload: row.payload as Record<string, unknown>,
    trustLevel: row.trustLevel as EmailTrustLevel,
    status: row.status as EmailAgentAction["status"],
    result: (row.result as string) ?? undefined,
    executedAt: row.executedAt
      ? (row.executedAt as Date).getTime()
      : undefined,
    createdAt: row.createdAt
      ? (row.createdAt as Date).getTime()
      : undefined,
  };
}

function resolveTrustLevel(
  actionType: EmailAgentActionType,
  config: EmailAgentConfig,
): EmailTrustLevel {
  return config.actionOverrides[actionType] ?? config.defaultTrustLevel;
}

function notifyPendingAction(action: EmailAgentAction): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("email:pending-action", action);
  }
}
