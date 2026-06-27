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

// Drop a pending waiter without resolving it. Used when the classifier
// auto-approves and the still-registered human waiter is no longer needed.
export function cancelConsentWaiter(requestId: string): void {
  pendingConsentResolvers.delete(requestId);
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

  // Strip the non-serializable callback before sending over IPC.
  const { autoApprove, ...serializableParams } = params;
  const requestId = `${params.serverId}:${params.toolName}:${crypto.randomUUID()}`;
  const send = (channel: string, payload: Record<string, unknown>) =>
    (event.sender as any).send(channel, payload);

  const finalize = async (
    response: ConsentDecision,
  ): Promise<McpConsentResult> => {
    if (response === "accept-always") {
      await setStoredConsent(params.serverId, params.toolName, "always");
      return { approved: true };
    }
    return { approved: response === "accept-once" };
  };

  // No classifier: show the prompt and wait for the user.
  if (!autoApprove) {
    send("mcp:tool-consent-request", { requestId, ...serializableParams });
    return finalize(await waitForConsent(requestId, params.chatId));
  }

  // Classifier active: show the prompt immediately with a spinner and race the
  // classifier against the user. The user can decide at any time.
  send("mcp:tool-consent-request", {
    requestId,
    ...serializableParams,
    classifierPending: true,
  });
  const humanPromise = waitForConsent(requestId, params.chatId).then(
    (decision) => ({ source: "human" as const, decision }),
  );
  // Fail closed if the classifier rejects: fall back to asking the user so the
  // race always settles and the prompt never sticks on the spinner.
  const classifierPromise = autoApprove()
    .then((result) => ({ source: "classifier" as const, result }))
    .catch(() => ({
      source: "classifier" as const,
      result: { approved: false } as McpAutoApproveResult,
    }));
  const winner = await Promise.race([humanPromise, classifierPromise]);

  if (winner.source === "human") {
    return finalize(winner.decision);
  }
  if (winner.result.approved) {
    // Auto-approved: dismiss the prompt and drop the still-registered waiter.
    cancelConsentWaiter(requestId);
    send("mcp:tool-consent-resolved", { requestId });
    return { approved: true, autoApprovedReason: winner.result.reason };
  }
  // Classifier wants review: drop the spinner, surface the reason, and keep
  // waiting for the user via the existing waiter.
  send("mcp:tool-consent-classified", {
    requestId,
    reason: winner.result.reason,
  });
  return finalize((await humanPromise).decision);
}
