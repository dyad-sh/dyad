/**
 * Agent OS — Tier 1 React hooks (TanStack Query).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showError } from "@/lib/toast";
import {
  AgentOsClient,
  type ActivityFilters,
  type CommandFilters,
  type FireIntentInput,
  type IntentFilters,
  type RegisterCommandInput,
  type StartActivityInput,
  type UpdateActivityInput,
} from "@/ipc/agent_os_client";
import type { OsCommandScope } from "@/db/agent_os_schema";

const client = AgentOsClient.getInstance();

export const osKeys = {
  all: ["os"] as const,
  commands: (filters?: CommandFilters) =>
    [...osKeys.all, "commands", filters ?? {}] as const,
  command: (id: string) => [...osKeys.all, "command", id] as const,
  search: (q: string, scope?: OsCommandScope) =>
    [...osKeys.all, "search", q, scope ?? null] as const,
  intents: (filters?: IntentFilters) =>
    [...osKeys.all, "intents", filters ?? {}] as const,
  intent: (id: string) => [...osKeys.all, "intent", id] as const,
  activities: (filters?: ActivityFilters) =>
    [...osKeys.all, "activities", filters ?? {}] as const,
  activity: (id: string) => [...osKeys.all, "activity", id] as const,
};

const handleError = (e: unknown) => {
  showError(e instanceof Error ? e : new Error(String(e)));
};

// ── Commands ──────────────────────────────────────────────────────────────

export function useOsCommands(filters: CommandFilters = {}) {
  return useQuery({
    queryKey: osKeys.commands(filters),
    queryFn: () => client.listCommands(filters),
  });
}

export function useOsCommand(id: string | undefined) {
  return useQuery({
    queryKey: osKeys.command(id ?? ""),
    queryFn: () => client.getCommand(id as string),
    enabled: Boolean(id),
  });
}

export function useOsCommandSearch(query: string, scope?: OsCommandScope) {
  return useQuery({
    queryKey: osKeys.search(query, scope),
    queryFn: () => client.searchCommands(query, scope),
    enabled: query.trim().length > 0,
  });
}

export function useRegisterOsCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterCommandInput) => client.registerCommand(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...osKeys.all, "commands"] }),
    onError: handleError,
  });
}

export function useUnregisterOsCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.unregisterCommand(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...osKeys.all, "commands"] }),
    onError: handleError,
  });
}

// ── Intents ───────────────────────────────────────────────────────────────

export function useOsIntents(filters: IntentFilters = {}) {
  return useQuery({
    queryKey: osKeys.intents(filters),
    queryFn: () => client.listIntents(filters),
  });
}

export function useOsIntent(id: string | undefined) {
  return useQuery({
    queryKey: osKeys.intent(id ?? ""),
    queryFn: () => client.getIntent(id as string),
    enabled: Boolean(id),
  });
}

export function useFireIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FireIntentInput) => client.fireIntent(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...osKeys.all, "intents"] }),
    onError: handleError,
  });
}

export function useDispatchIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (intentId: string) => client.dispatchIntent(intentId),
    onSuccess: (outcome) => {
      qc.invalidateQueries({ queryKey: [...osKeys.all, "intents"] });
      if (outcome.intent?.id) {
        qc.invalidateQueries({ queryKey: osKeys.intent(outcome.intent.id) });
      }
    },
    onError: handleError,
  });
}

export function useCancelIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.cancelIntent(id),
    onSuccess: (intent) => {
      qc.invalidateQueries({ queryKey: [...osKeys.all, "intents"] });
      qc.invalidateQueries({ queryKey: osKeys.intent(intent.id) });
    },
    onError: handleError,
  });
}

// ── Activities ────────────────────────────────────────────────────────────

export function useOsActivities(filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: osKeys.activities(filters),
    queryFn: () => client.listActivities(filters),
  });
}

export function useOsActivity(id: string | undefined) {
  return useQuery({
    queryKey: osKeys.activity(id ?? ""),
    queryFn: () => client.getActivity(id as string),
    enabled: Boolean(id),
  });
}

export function useStartActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartActivityInput) => client.startActivity(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...osKeys.all, "activities"] }),
    onError: handleError,
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; patch: UpdateActivityInput }) =>
      client.updateActivity(params),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: [...osKeys.all, "activities"] });
      qc.invalidateQueries({ queryKey: osKeys.activity(row.id) });
    },
    onError: handleError,
  });
}
