import { db } from "../../db";
import { mcpToolConsents } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";
import crypto from "node:crypto";

export type Consent = "ask" | "always" | "denied";

type ConsentDecision = "accept-once" | "accept-always" | "decline";

interface PendingMcpConsent {
  chatId: number;
  resolve: (d: ConsentDecision) => void;
}

const pendingConsentResolvers = new Map<string, PendingMcpConsent>();

export function waitForConsent(
  requestId: string,
  chatId: number,
): Promise<ConsentDecision> {
  return new Promise((resolve) => {
    pendingConsentResolvers.set(requestId, { chatId, resolve });
  });
}

export function resolveConsent(requestId: string, decision: ConsentDecision) {
  const entry = pendingConsentResolvers.get(requestId);
  if (entry) {
    pendingConsentResolvers.delete(requestId);
    entry.resolve(decision);
  }
}

// Resolve any pending MCP consents for a chat as declined. Called when a stream
// is cancelled or ends so the tool calls unblock instead of hanging once their
// consent UI has been cleared.
export function clearPendingMcpConsentsForChat(chatId: number): void {
  for (const [requestId, entry] of pendingConsentResolvers) {
    if (entry.chatId === chatId) {
      pendingConsentResolvers.delete(requestId);
      entry.resolve("decline");
    }
  }
}

export async function getStoredConsent(
  serverId: number,
  toolName: string,
): Promise<Consent> {
  const rows = await db
    .select()
    .from(mcpToolConsents)
    .where(
      and(
        eq(mcpToolConsents.serverId, serverId),
        eq(mcpToolConsents.toolName, toolName),
      ),
    );
  if (rows.length === 0) return "ask";
  return (rows[0].consent as Consent) ?? "ask";
}

export async function setStoredConsent(
  serverId: number,
  toolName: string,
  consent: Consent,
): Promise<void> {
  const rows = await db
    .select()
    .from(mcpToolConsents)
    .where(
      and(
        eq(mcpToolConsents.serverId, serverId),
        eq(mcpToolConsents.toolName, toolName),
      ),
    );
  if (rows.length > 0) {
    await db
      .update(mcpToolConsents)
      .set({ consent })
      .where(
        and(
          eq(mcpToolConsents.serverId, serverId),
          eq(mcpToolConsents.toolName, toolName),
        ),
      );
  } else {
    await db.insert(mcpToolConsents).values({ serverId, toolName, consent });
  }
}

// Result of the auto-approve hook: whether the classifier auto-approved, plus
// its one-sentence reason (shown to the user on either path).
export interface McpAutoApproveResult {
  approved: boolean;
  reason?: string;
}

// Result of a consent check. autoApprovedReason is set only when the classifier
// auto-approved, so the caller can surface it on the tool-call card.
export interface McpConsentResult {
  approved: boolean;
  autoApprovedReason?: string;
}

export async function requireMcpToolConsent(
  event: IpcMainInvokeEvent,
  params: {
    serverId: number;
    serverName: string;
    toolName: string;
    toolDescription?: string | null;
    inputPreview?: string | null;
    chatId: number;
    // Optional auto-approve hook (agent mode, Pro). Runs only on the "ask"
    // path, so explicit always/denied choices still win.
    autoApprove?: () => Promise<McpAutoApproveResult>;
  },
): Promise<McpConsentResult> {
  const current = await getStoredConsent(params.serverId, params.toolName);
  if (current === "always") return { approved: true };
  if (current === "denied") return { approved: false };

  // The classifier's reason for asking, shown in the consent prompt.
  let classifierReason: string | undefined;
  if (params.autoApprove) {
    const result = await params.autoApprove();
    if (result.approved) {
      return { approved: true, autoApprovedReason: result.reason };
    }
    classifierReason = result.reason;
  }

  // Ask renderer for a decision via event bridge. Strip non-serializable
  // fields (the autoApprove callback) before sending over IPC.
  const { autoApprove: _autoApprove, ...serializableParams } = params;
  const requestId = `${params.serverId}:${params.toolName}:${crypto.randomUUID()}`;
  (event.sender as any).send("mcp:tool-consent-request", {
    requestId,
    ...serializableParams,
    reason: classifierReason,
  });
  const response = await waitForConsent(requestId, params.chatId);

  if (response === "accept-always") {
    await setStoredConsent(params.serverId, params.toolName, "always");
    return { approved: true };
  }
  if (response === "decline") {
    return { approved: false };
  }
  return { approved: response === "accept-once" };
}
