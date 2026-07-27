import type { IpcMainInvokeEvent } from "electron";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentToolConsent } from "@/lib/schemas";
import type { SqlConsentMetadata } from "@/shared/sqlConsentMetadata";
import {
  rememberUserInputSubscriber,
  userInputRegistry,
} from "@/user_input/main";

export async function requestPiToolConsent(
  event: IpcMainInvokeEvent,
  params: {
    chatId: number;
    toolName: string;
    toolDescription?: string | null;
    inputPreview?: string | null;
    metadata?: SqlConsentMetadata | null;
    abortSignal?: AbortSignal;
    consent: AgentToolConsent;
    autoApproveNonSchemaSql: boolean;
  },
): Promise<boolean> {
  const current = params.consent;
  if (current === "always") return true;
  if (current === "never") {
    throw new DyadError(
      "Should not ask for consent for a tool marked as 'never'",
      DyadErrorKind.Internal,
    );
  }

  if (
    params.toolName === "execute_sql" &&
    params.metadata?.sqlMutatesSchema === false &&
    params.metadata.sqlDeletesData === false &&
    params.metadata.sqlSafeForAutoApproval === true &&
    params.autoApproveNonSchemaSql
  ) {
    return true;
  }

  rememberUserInputSubscriber(event.sender);
  const requestId = userInputRegistry.request({
    kind: "agent-consent",
    chatId: params.chatId,
    toolName: params.toolName,
    toolDescription: params.toolDescription,
    inputPreview: params.inputPreview,
    metadata: params.metadata,
  });
  const response = await userInputRegistry.park(requestId, params.abortSignal);
  return response?.kind === "agent-consent" && response.decision !== "decline";
}
