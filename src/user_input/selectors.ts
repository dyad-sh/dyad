import type { UserInputQuestionPayload } from "@/ipc/types/user_input";
import type { SqlConsentMetadata } from "@/shared/sqlConsentMetadata";
import type {
  UserInputReadModelSnapshot,
  UserInputRequests,
} from "./read_model";

export interface PendingQuestionnaire {
  chatId: number;
  requestId: string;
  questions: UserInputQuestionPayload[];
  isResponding: boolean;
}

export interface PendingIntegration {
  chatId: number;
  requestId: string;
  provider?: "supabase" | "neon";
}

export interface PendingToolConsent {
  kind: "agent";
  requestId: string;
  chatId: number;
  toolName: string;
  toolDescription?: string | null;
  inputPreview?: string | null;
  metadata?: SqlConsentMetadata | null;
}

const toolConsentCache = new WeakMap<
  UserInputReadModelSnapshot,
  Map<number | undefined, PendingToolConsent[]>
>();

export function selectPendingQuestionnaires({
  requests,
  respondingRequestIds,
}: UserInputReadModelSnapshot): Map<number, PendingQuestionnaire> {
  const questionnaires = new Map<number, PendingQuestionnaire>();
  for (const request of requests.values()) {
    if (request.status === "settled") continue;
    const descriptor = request.descriptor;
    if (descriptor.kind !== "questionnaire") continue;
    questionnaires.set(descriptor.chatId, {
      chatId: descriptor.chatId,
      requestId: descriptor.requestId,
      questions: descriptor.questions,
      isResponding: respondingRequestIds.has(descriptor.requestId),
    });
  }
  return questionnaires;
}

export function selectPendingIntegrations(
  requests: UserInputRequests,
  selectedProviders: ReadonlyMap<string, "supabase" | "neon">,
): Map<number, PendingIntegration> {
  const pending = new Map<number, PendingIntegration>();
  for (const request of requests.values()) {
    if (request.status !== "awaiting") continue;
    const descriptor = request.descriptor;
    if (descriptor.kind !== "integration") continue;
    pending.set(descriptor.chatId, {
      chatId: descriptor.chatId,
      requestId: descriptor.requestId,
      provider:
        selectedProviders.get(descriptor.requestId) ?? descriptor.provider,
    });
  }
  return pending;
}

export function selectPendingToolConsents(
  snapshot: UserInputReadModelSnapshot,
  chatId: number | undefined,
): PendingToolConsent[] {
  let byChatId = toolConsentCache.get(snapshot);
  if (!byChatId) {
    byChatId = new Map();
    toolConsentCache.set(snapshot, byChatId);
  }
  const cached = byChatId.get(chatId);
  if (cached) return cached;
  const { requests, respondingRequestIds } = snapshot;
  const consents: PendingToolConsent[] = [];
  for (const request of requests.values()) {
    if (request.status === "settled") continue;
    const descriptor = request.descriptor;
    if (
      descriptor.chatId !== chatId ||
      respondingRequestIds.has(descriptor.requestId)
    ) {
      continue;
    }
    if (descriptor.kind === "agent-consent") {
      consents.push({
        kind: "agent",
        requestId: descriptor.requestId,
        chatId: descriptor.chatId,
        toolName: descriptor.toolName,
        toolDescription: descriptor.toolDescription,
        inputPreview: descriptor.inputPreview,
        metadata: descriptor.metadata as SqlConsentMetadata | null | undefined,
      });
    }
  }
  byChatId.set(chatId, consents);
  return consents;
}
