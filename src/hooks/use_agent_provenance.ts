/**
 * Agent Provenance & Reputation hooks (TanStack Query) — Tier 4.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showError } from "@/lib/toast";
import {
  AgentProvenanceClient,
  type EmitEventInput,
  type EventFilters,
  type ProposeSlashInput,
  type ScoreFilters,
  type SlashFilters,
} from "@/ipc/agent_provenance_client";

const client = AgentProvenanceClient.getInstance();

export const provenanceKeys = {
  all: ["provenance"] as const,
  events: (filters?: EventFilters) =>
    [...provenanceKeys.all, "events", filters ?? {}] as const,
  event: (id: string) => [...provenanceKeys.all, "event", id] as const,
  score: (did: string) => [...provenanceKeys.all, "score", did] as const,
  scores: (filters?: ScoreFilters) =>
    [...provenanceKeys.all, "scores", filters ?? {}] as const,
  slashes: (filters?: SlashFilters) =>
    [...provenanceKeys.all, "slashes", filters ?? {}] as const,
};

const handleError = (e: unknown) => {
  showError(e instanceof Error ? e : new Error(String(e)));
};

// Events

export function useProvenanceEvents(filters: EventFilters = {}) {
  return useQuery({
    queryKey: provenanceKeys.events(filters),
    queryFn: () => client.listEvents(filters),
  });
}

export function useProvenanceEvent(id: string | undefined) {
  return useQuery({
    queryKey: provenanceKeys.event(id ?? ""),
    queryFn: () => client.getEvent(id as string),
    enabled: Boolean(id),
  });
}

export function useEmitEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmitEventInput) => client.emitEvent(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...provenanceKeys.all, "events"] }),
    onError: handleError,
  });
}

export function usePinEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.pinEvent(id),
    onSuccess: (event) => {
      qc.invalidateQueries({ queryKey: provenanceKeys.event(event.id) });
      qc.invalidateQueries({ queryKey: [...provenanceKeys.all, "events"] });
    },
    onError: handleError,
  });
}

// Reputation

export function useReputationScore(principalDid: string | undefined) {
  return useQuery({
    queryKey: provenanceKeys.score(principalDid ?? ""),
    queryFn: () => client.getScore(principalDid as string),
    enabled: Boolean(principalDid),
  });
}

export function useReputationScores(filters: ScoreFilters = {}) {
  return useQuery({
    queryKey: provenanceKeys.scores(filters),
    queryFn: () => client.listScores(filters),
  });
}

export function useRecomputeScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (principalDid: string) => client.recomputeScore(principalDid),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: provenanceKeys.score(row.principalDid) });
      qc.invalidateQueries({ queryKey: [...provenanceKeys.all, "scores"] });
    },
    onError: handleError,
  });
}

// Slashing

export function useSlashes(filters: SlashFilters = {}) {
  return useQuery({
    queryKey: provenanceKeys.slashes(filters),
    queryFn: () => client.listSlashes(filters),
  });
}

export function useProposeSlash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProposeSlashInput) => client.proposeSlash(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...provenanceKeys.all, "slashes"] }),
    onError: handleError,
  });
}

export function useActivateSlash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.activateSlash(id),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: [...provenanceKeys.all, "slashes"] });
      qc.invalidateQueries({ queryKey: provenanceKeys.score(row.principalDid) });
      qc.invalidateQueries({ queryKey: [...provenanceKeys.all, "events"] });
    },
    onError: handleError,
  });
}

export function useReverseSlash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      client.reverseSlash(params),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: [...provenanceKeys.all, "slashes"] });
      qc.invalidateQueries({ queryKey: provenanceKeys.score(row.principalDid) });
    },
    onError: handleError,
  });
}
