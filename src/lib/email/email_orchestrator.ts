/**
 * Email Autonomous Orchestrator
 *
 * Background service that automatically processes emails based on
 * AI triage results and user-defined rules. Supports:
 * - Auto-archive newsletters / promotional emails
 * - Auto-label by AI category
 * - Rule-based actions (from pattern, subject pattern, category, priority)
 * - Scheduled daily digest generation
 *
 * Respects the agent trust-level system — destructive actions go through
 * the agent executor (confirm / auto / never).
 */

import { db } from "@/db";
import {
  emailAccounts,
  emailMessages,
  emailAgentActions,
} from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { BrowserWindow } from "electron";
import log from "electron-log";
import { triageMessage, generateDailyDigest } from "./email_ai_service";
import { submitAction } from "./email_agent_executor";
import type {
  EmailAutoRule,
  EmailCategory,
  EmailPriority,
  EmailAgentConfig,
  EmailOrchestratorStatus,
  EmailMessage,
  DailyDigest,
} from "@/types/email_types";

const logger = log.scope("email/orchestrator");

// ─── In-Memory State ─────────────────────────────────────────────────────────

let running = false;
let processTimer: ReturnType<typeof setInterval> | null = null;
let digestTimer: ReturnType<typeof setTimeout> | null = null;
let rules: EmailAutoRule[] = [];
let autoTriageEnabled = true;
let autoActionsEnabled = true;
let messagesProcessed = 0;
let actionsExecuted = 0;
let lastRunAt: number | undefined;

/** Default agent config for orchestrator-submitted actions */
let agentConfig: EmailAgentConfig = {
  defaultTrustLevel: "confirm",
  actionOverrides: {},
  autoTriageEnabled: true,
  autoSummarizeEnabled: false,
  followUpTrackingEnabled: true,
  dailyDigestEnabled: true,
  dailyDigestTime: "09:00",
};

// ─── Public API ──────────────────────────────────────────────────────────────

export function startOrchestrator(config?: Partial<EmailAgentConfig>): void {
  if (running) return;

  if (config) {
    agentConfig = { ...agentConfig, ...config };
    autoTriageEnabled = agentConfig.autoTriageEnabled;
  }

  running = true;

  // Process queue every 30 seconds
  processTimer = setInterval(() => {
    processUntriagedMessages().catch((err) =>
      logger.error(`Orchestrator process error: ${err}`),
    );
  }, 30_000);

  // Schedule daily digest
  scheduleDailyDigest();

  logger.info("Email orchestrator started");
  emitOrchestratorEvent("started");
}

export function stopOrchestrator(): void {
  if (!running) return;

  if (processTimer) {
    clearInterval(processTimer);
    processTimer = null;
  }
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
  }

  running = false;
  logger.info("Email orchestrator stopped");
  emitOrchestratorEvent("stopped");
}

export function getOrchestratorStatus(): EmailOrchestratorStatus {
  return {
    running,
    autoTriageEnabled,
    autoActionsEnabled,
    rulesCount: rules.length,
    lastRunAt,
    messagesProcessed,
    actionsExecuted,
  };
}

export function setAutoTriage(enabled: boolean): void {
  autoTriageEnabled = enabled;
  agentConfig.autoTriageEnabled = enabled;
}

export function setAutoActions(enabled: boolean): void {
  autoActionsEnabled = enabled;
}

export function updateAgentConfig(config: Partial<EmailAgentConfig>): void {
  agentConfig = { ...agentConfig, ...config };
  autoTriageEnabled = agentConfig.autoTriageEnabled;

  // Reschedule digest if time changed
  if (config.dailyDigestTime || config.dailyDigestEnabled !== undefined) {
    scheduleDailyDigest();
  }
}

// ─── Rules Management ────────────────────────────────────────────────────────

export function getRules(): EmailAutoRule[] {
  return [...rules];
}

export function addRule(rule: Omit<EmailAutoRule, "id" | "createdAt">): EmailAutoRule {
  const newRule: EmailAutoRule = {
    ...rule,
    id: Date.now(),
    createdAt: Date.now(),
  };
  rules.push(newRule);
  logger.info(`Added auto-rule: ${newRule.name}`);
  return newRule;
}

export function updateRule(
  ruleId: number,
  updates: Partial<Omit<EmailAutoRule, "id" | "createdAt">>,
): EmailAutoRule | null {
  const idx = rules.findIndex((r) => r.id === ruleId);
  if (idx === -1) return null;

  rules[idx] = { ...rules[idx], ...updates };
  return rules[idx];
}

export function removeRule(ruleId: number): boolean {
  const idx = rules.findIndex((r) => r.id === ruleId);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  return true;
}

// ─── Processing Logic ────────────────────────────────────────────────────────

/**
 * Find un-triaged messages and run AI triage + auto-rules on them.
 */
async function processUntriagedMessages(): Promise<void> {
  if (!autoTriageEnabled && !autoActionsEnabled) return;

  lastRunAt = Date.now();

  // Find messages without AI triage
  const untriaged = db
    .select()
    .from(emailMessages)
    .where(isNull(emailMessages.priority))
    .limit(20)
    .all();

  if (untriaged.length === 0) return;

  logger.info(`Processing ${untriaged.length} untriaged messages`);

  for (const row of untriaged) {
    try {
      const msg = row as unknown as EmailMessage;

      if (autoTriageEnabled) {
        const result = await triageMessage(msg);

        db.update(emailMessages)
          .set({
            priority: result.priority,
            aiCategory: result.category,
            aiFollowUpDate: result.followUpDate
              ? new Date(result.followUpDate)
              : null,
          })
          .where(eq(emailMessages.id, msg.id))
          .run();

        messagesProcessed++;

        // Now apply auto-rules if enabled
        if (autoActionsEnabled) {
          await applyRules(msg, result.category, result.priority);
        }
      }
    } catch (err) {
      logger.warn(`Failed to process message ${row.id}: ${err}`);
    }
  }
}

/**
 * Apply user-defined rules to a triaged message.
 */
async function applyRules(
  msg: EmailMessage,
  category: EmailCategory,
  priority: EmailPriority,
): Promise<void> {
  const enabledRules = rules.filter((r) => r.enabled);

  for (const rule of enabledRules) {
    if (!matchesRule(msg, rule, category, priority)) continue;

    logger.info(`Rule "${rule.name}" matches message ${msg.id}`);

    try {
      await submitAction(
        {
          accountId: msg.accountId,
          actionType: mapRuleActionToAgentAction(rule.action),
          targetMessageId: msg.id,
          payload: buildRulePayload(msg, rule),
          trustLevel: agentConfig.defaultTrustLevel,
        },
        agentConfig,
      );
      actionsExecuted++;
    } catch (err) {
      logger.warn(`Rule "${rule.name}" action failed: ${err}`);
    }
  }
}

function matchesRule(
  msg: EmailMessage,
  rule: EmailAutoRule,
  category: EmailCategory,
  priority: EmailPriority,
): boolean {
  const cond = rule.condition;

  if (cond.aiCategory && cond.aiCategory !== category) return false;
  if (cond.priority && cond.priority !== priority) return false;

  if (cond.fromPattern) {
    try {
      const re = new RegExp(cond.fromPattern, "i");
      if (!re.test(msg.from.address) && !re.test(msg.from.name ?? "")) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (cond.subjectPattern) {
    try {
      const re = new RegExp(cond.subjectPattern, "i");
      if (!re.test(msg.subject)) return false;
    } catch {
      return false;
    }
  }

  return true;
}

function mapRuleActionToAgentAction(action: string): "archive" | "label" | "mark_read" | "delete" | "move" {
  switch (action) {
    case "archive": return "archive";
    case "label": return "label";
    case "mark_read": return "mark_read";
    case "delete": return "delete";
    case "star": return "mark_read"; // star uses mark_read with starred payload
    default: return "archive";
  }
}

function buildRulePayload(
  msg: EmailMessage,
  rule: EmailAutoRule,
): Record<string, unknown> {
  const base = {
    remoteId: msg.remoteId,
    fromFolder: msg.folder,
  };

  switch (rule.action) {
    case "archive":
      return { ...base, toFolder: "archive" };
    case "label":
      return { ...base, label: rule.actionTarget ?? "default" };
    case "mark_read":
      return { ...base, read: true, folder: msg.folder };
    case "delete":
      return { ...base, folder: msg.folder };
    case "star":
      return { ...base, starred: true, folder: msg.folder };
    default:
      return base;
  }
}

// ─── Scheduled Digest ────────────────────────────────────────────────────────

function scheduleDailyDigest(): void {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
  }

  if (!agentConfig.dailyDigestEnabled) return;

  const targetTime = agentConfig.dailyDigestTime ?? "09:00";
  const [hours, minutes] = targetTime.split(":").map(Number);

  const now = new Date();
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  const delay = next.getTime() - now.getTime();

  digestTimer = setTimeout(async () => {
    try {
      await runDailyDigest();
    } catch (err) {
      logger.error(`Daily digest failed: ${err}`);
    }
    // Re-schedule for tomorrow
    scheduleDailyDigest();
  }, delay);

  logger.info(
    `Daily digest scheduled for ${next.toISOString()} (in ${Math.round(delay / 60_000)} min)`,
  );
}

async function runDailyDigest(): Promise<DailyDigest> {
  const msgs = db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.isRead, false))
    .limit(200)
    .all();

  const digest = await generateDailyDigest(msgs as unknown as EmailMessage[]);

  // Notify the UI
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("email:daily-digest-ready", digest);
  }

  logger.info(`Daily digest generated: ${digest.totalUnread} unread emails`);
  return digest;
}

// ─── Events ──────────────────────────────────────────────────────────────────

function emitOrchestratorEvent(type: string): void {
  const status = getOrchestratorStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("email:orchestrator-status", { type, ...status });
  }
}
