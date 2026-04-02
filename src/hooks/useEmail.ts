/**
 * Email Hooks
 *
 * TanStack Query hooks for all email operations, following the
 * established pattern: useQuery for reads, useMutation for writes.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmailClient } from "@/ipc/email_client";
import { useEffect } from "react";
import { toast } from "sonner";
import type {
  AddEmailAccountPayload,
  EmailAccountConfig,
  EmailAgentConfig,
  EmailAutoRule,
  EmailComposeRequest,
  EmailDraft,
  EmailOrchestratorStatus,
  EmailSearchQuery,
  EmailSyncEvent,
  EmailAgentAction,
  DailyDigest,
} from "@/types/email_types";

const client = EmailClient.getInstance();

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const emailKeys = {
  all: ["email"] as const,
  accounts: () => [...emailKeys.all, "accounts"] as const,
  account: (id: string) => [...emailKeys.accounts(), id] as const,
  folders: (accountId: string) =>
    [...emailKeys.all, "folders", accountId] as const,
  messages: (accountId: string, folder: string) =>
    [...emailKeys.all, "messages", accountId, folder] as const,
  unifiedMessages: (folder: string) =>
    [...emailKeys.all, "unified", folder] as const,
  message: (id: number) => [...emailKeys.all, "message", id] as const,
  thread: (threadId: string) =>
    [...emailKeys.all, "thread", threadId] as const,
  search: (query: EmailSearchQuery) =>
    [...emailKeys.all, "search", query] as const,
  drafts: (accountId: string) =>
    [...emailKeys.all, "drafts", accountId] as const,
  stats: (accountId?: string) =>
    [...emailKeys.all, "stats", accountId] as const,
  pendingActions: (accountId: string) =>
    [...emailKeys.all, "pending-actions", accountId] as const,
};

// ─── Account Hooks ───────────────────────────────────────────────────────────

export function useEmailAccounts() {
  return useQuery({
    queryKey: emailKeys.accounts(),
    queryFn: () => client.listAccounts(),
  });
}

export function useEmailAccount(accountId: string) {
  return useQuery({
    queryKey: emailKeys.account(accountId),
    queryFn: () => client.getAccount(accountId),
    enabled: !!accountId,
  });
}

export function useAddEmailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddEmailAccountPayload) =>
      client.addAccount(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.accounts() });
    },
  });
}

export function useRemoveEmailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => client.removeAccount(accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.accounts() });
    },
  });
}

// ─── Folder Hooks ────────────────────────────────────────────────────────────

export function useEmailFolders(accountId: string) {
  return useQuery({
    queryKey: emailKeys.folders(accountId),
    queryFn: () => client.listFolders(accountId),
    enabled: !!accountId,
  });
}

// ─── Message Hooks ───────────────────────────────────────────────────────────

export function useEmailMessages(
  accountId: string,
  folder: string,
  options?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: emailKeys.messages(accountId, folder),
    queryFn: () => client.listMessages(accountId, folder, options),
    enabled: !!accountId && !!folder,
  });
}

export function useUnifiedMessages(
  folder: string,
  options?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: emailKeys.unifiedMessages(folder),
    queryFn: () => client.listUnifiedMessages(folder, options),
    enabled: !!folder,
  });
}

export function useEmailMessage(messageId: number | null) {
  return useQuery({
    queryKey: emailKeys.message(messageId ?? 0),
    queryFn: () => client.getMessage(messageId!),
    enabled: messageId != null,
  });
}

export function useEmailThread(threadId: string | null) {
  return useQuery({
    queryKey: emailKeys.thread(threadId ?? ""),
    queryFn: () => client.getThread(threadId!),
    enabled: !!threadId,
  });
}

export function useEmailSearch(query: EmailSearchQuery | null) {
  return useQuery({
    queryKey: emailKeys.search(query ?? ({} as EmailSearchQuery)),
    queryFn: () => client.searchMessages(query!),
    enabled: !!query,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, read }: { messageId: number; read: boolean }) =>
      client.markRead(messageId, read),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

export function useMarkStarred() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      starred,
    }: { messageId: number; starred: boolean }) =>
      client.markStarred(messageId, starred),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

export function useMoveMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      toFolder,
    }: { messageId: number; toFolder: string }) =>
      client.moveMessage(messageId, toFolder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => client.deleteMessage(messageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

// ─── Send / Draft Hooks ──────────────────────────────────────────────────────

export function useSendEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      draft,
    }: { accountId: string; draft: EmailDraft }) =>
      client.sendEmail(accountId, draft),
    onSuccess: () => {
      toast.success("Email sent");
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
    onError: (err: Error) => {
      toast.error(`Failed to send email: ${err.message}`);
    },
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: EmailDraft) => client.saveDraft(draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

export function useEmailDrafts(accountId: string) {
  return useQuery({
    queryKey: emailKeys.drafts(accountId),
    queryFn: () => client.listDrafts(accountId),
    enabled: !!accountId,
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draftId: number) => client.deleteDraft(draftId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

// ─── AI Hooks ────────────────────────────────────────────────────────────────

export function useTriageMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => client.triageMessage(messageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

export function useTriageBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageIds: number[]) => client.triageBatch(messageIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

export function useSummarizeMessages() {
  return useMutation({
    mutationFn: (messageIds: number[]) =>
      client.summarizeMessages(messageIds),
  });
}

export function useComposeEmail() {
  return useMutation({
    mutationFn: ({
      accountId,
      request,
    }: { accountId: string; request: EmailComposeRequest }) =>
      client.composeEmail(accountId, request),
  });
}

export function useAdjustTone() {
  return useMutation({
    mutationFn: ({
      draft,
      tone,
    }: {
      draft: EmailDraft;
      tone: "formal" | "casual" | "friendly" | "urgent";
    }) => client.adjustTone(draft, tone),
  });
}

export function useSmartReplies(messageId: number | null) {
  return useQuery({
    queryKey: [...emailKeys.all, "smart-replies", messageId],
    queryFn: () => client.smartReplies(messageId!),
    enabled: messageId != null,
  });
}

export function useDetectFollowUps() {
  return useMutation({
    mutationFn: (messageId: number) => client.detectFollowUps(messageId),
  });
}

export function useDailyDigest() {
  return useQuery({
    queryKey: [...emailKeys.all, "daily-digest"],
    queryFn: () => client.dailyDigest(),
  });
}

// ─── Agent Action Hooks ──────────────────────────────────────────────────────

export function usePendingActions(accountId: string) {
  return useQuery({
    queryKey: emailKeys.pendingActions(accountId),
    queryFn: () => client.getPendingActions(accountId),
    enabled: !!accountId,
    refetchInterval: 5000,
  });
}

export function useApproveAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionId: number) => client.approveAction(actionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

export function useRejectAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionId: number) => client.rejectAction(actionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

// ─── Sync Hooks ──────────────────────────────────────────────────────────────

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => client.syncNow(accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

export function useEmailStats(accountId?: string) {
  return useQuery({
    queryKey: emailKeys.stats(accountId),
    queryFn: () => client.getStats(accountId),
    refetchInterval: 30_000,
  });
}

// ─── Event Subscriptions ─────────────────────────────────────────────────────

export function useEmailSyncEvents(
  onEvent: (event: EmailSyncEvent) => void,
) {
  useEffect(() => {
    return client.onSyncEvent(onEvent);
  }, [onEvent]);
}

export function useEmailPendingActionEvents(
  onAction: (action: EmailAgentAction) => void,
) {
  useEffect(() => {
    return client.onPendingAction(onAction);
  }, [onAction]);
}

// ─── Orchestrator Hooks ──────────────────────────────────────────────────────

export const orchestratorKeys = {
  status: [...emailKeys.all, "orchestrator-status"] as const,
  rules: [...emailKeys.all, "orchestrator-rules"] as const,
};

export function useOrchestratorStatus() {
  return useQuery({
    queryKey: orchestratorKeys.status,
    queryFn: () => client.getOrchestratorStatus(),
    refetchInterval: 10_000,
  });
}

export function useStartOrchestrator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config?: Partial<EmailAgentConfig>) =>
      client.startOrchestrator(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orchestratorKeys.status });
    },
  });
}

export function useStopOrchestrator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.stopOrchestrator(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orchestratorKeys.status });
    },
  });
}

export function useSetAutoTriage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => client.setAutoTriage(enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orchestratorKeys.status });
    },
  });
}

export function useSetAutoActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => client.setAutoActions(enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orchestratorKeys.status });
    },
  });
}

export function useUpdateOrchestratorConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Partial<EmailAgentConfig>) =>
      client.updateOrchestratorConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orchestratorKeys.status });
    },
  });
}

export function useAutoRules() {
  return useQuery({
    queryKey: orchestratorKeys.rules,
    queryFn: () => client.listAutoRules(),
  });
}

export function useAddAutoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule: Omit<EmailAutoRule, "id" | "createdAt">) =>
      client.addAutoRule(rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orchestratorKeys.rules });
    },
  });
}

export function useUpdateAutoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ruleId,
      updates,
    }: { ruleId: number; updates: Partial<EmailAutoRule> }) =>
      client.updateAutoRule(ruleId, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orchestratorKeys.rules });
    },
  });
}

export function useRemoveAutoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: number) => client.removeAutoRule(ruleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orchestratorKeys.rules });
    },
  });
}

export function useOrchestratorStatusEvents(
  onStatus: (status: EmailOrchestratorStatus & { type: string }) => void,
) {
  useEffect(() => {
    return client.onOrchestratorStatus(onStatus);
  }, [onStatus]);
}

export function useDailyDigestEvents(
  onDigest: (digest: DailyDigest) => void,
) {
  useEffect(() => {
    return client.onDailyDigestReady(onDigest);
  }, [onDigest]);
}
