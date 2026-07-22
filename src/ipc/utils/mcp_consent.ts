import { db } from "../../db";
import { mcpToolConsents } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";
import {
  rememberUserInputSubscriber,
  userInputRegistry,
} from "../../user_input/main";

export type Consent = "ask" | "always" | "denied";

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
    abortSignal?: AbortSignal;
  },
): Promise<McpConsentResult> {
  const current = await getStoredConsent(params.serverId, params.toolName);
  if (current === "always") return { approved: true };
  if (current === "denied") return { approved: false };

  const { autoApprove, abortSignal } = params;
  rememberUserInputSubscriber(event.sender);
  const requestId = userInputRegistry.request({
    kind: "mcp-consent",
    chatId: params.chatId,
    serverId: params.serverId,
    serverName: params.serverName,
    toolName: params.toolName,
    toolDescription: params.toolDescription,
    inputPreview: params.inputPreview,
    classifier: autoApprove ? "racing" : "none",
  });

  if (autoApprove) {
    void autoApprove()
      .then((result) =>
        userInputRegistry.classifierDecided(
          requestId,
          result.approved,
          result.reason,
        ),
      )
      .catch(() => userInputRegistry.classifierDecided(requestId, false));
  }

  const response = await userInputRegistry.park(requestId, abortSignal);
  if (response?.kind === "classifier-approved") {
    return { approved: true, autoApprovedReason: response.reason };
  }
  if (response?.kind !== "mcp-consent") return { approved: false };
  return { approved: response.decision !== "decline" };
}
