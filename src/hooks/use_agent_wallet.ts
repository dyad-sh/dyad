/**
 * Agent Wallet & Policy hooks (TanStack Query) — Tier 2.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showError } from "@/lib/toast";
import {
  AgentWalletClient,
  type CapabilityFilters,
  type CreatePolicyInput,
  type IssueCapabilityInput,
  type PolicyContext,
  type PolicyFilters,
  type PolicyPatch,
  type SignIntentInput,
} from "@/ipc/agent_wallet_client";

const client = AgentWalletClient.getInstance();

export const walletKeys = {
  all: ["wallet"] as const,
  capabilities: (filters?: CapabilityFilters) =>
    [...walletKeys.all, "capabilities", filters ?? {}] as const,
  capability: (id: string) => [...walletKeys.all, "capability", id] as const,
  capabilityCheck: (principalId: string, capability: string) =>
    [...walletKeys.all, "capability-check", principalId, capability] as const,
  policies: (filters?: PolicyFilters) =>
    [...walletKeys.all, "policies", filters ?? {}] as const,
  policyEval: (ctx: PolicyContext) =>
    [...walletKeys.all, "policy-eval", ctx] as const,
  signedIntents: (intentId?: string, principalDid?: string) =>
    [
      ...walletKeys.all,
      "signed-intents",
      intentId ?? null,
      principalDid ?? null,
    ] as const,
};

const handleError = (e: unknown) => {
  showError(e instanceof Error ? e : new Error(String(e)));
};

// Capabilities

export function useCapabilities(filters: CapabilityFilters = {}) {
  return useQuery({
    queryKey: walletKeys.capabilities(filters),
    queryFn: () => client.listCapabilities(filters),
  });
}

export function useCapability(id: string | undefined) {
  return useQuery({
    queryKey: walletKeys.capability(id ?? ""),
    queryFn: () => client.getCapability(id as string),
    enabled: Boolean(id),
  });
}

export function useCapabilityCheck(
  principalId: string | undefined,
  capability: string | undefined,
) {
  return useQuery({
    queryKey: walletKeys.capabilityCheck(principalId ?? "", capability ?? ""),
    queryFn: () =>
      client.checkCapability({
        principalId: principalId as string,
        capability: capability as string,
      }),
    enabled: Boolean(principalId && capability),
  });
}

export function useIssueCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueCapabilityInput) => client.issueCapability(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...walletKeys.all, "capabilities"] }),
    onError: handleError,
  });
}

export function useRevokeCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; reason?: string }) =>
      client.revokeCapability(params),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...walletKeys.all, "capabilities"] }),
    onError: handleError,
  });
}

// Policies

export function usePolicies(filters: PolicyFilters = {}) {
  return useQuery({
    queryKey: walletKeys.policies(filters),
    queryFn: () => client.listPolicies(filters),
  });
}

export function useEvaluatePolicy(ctx: PolicyContext | null) {
  return useQuery({
    queryKey: ctx
      ? walletKeys.policyEval(ctx)
      : [...walletKeys.all, "policy-eval", "disabled"],
    queryFn: () => client.evaluatePolicy(ctx as PolicyContext),
    enabled: Boolean(ctx?.principalId && ctx?.capability),
  });
}

export function useCreatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePolicyInput) => client.createPolicy(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...walletKeys.all, "policies"] }),
    onError: handleError,
  });
}

export function useUpdatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; patch: PolicyPatch }) =>
      client.updatePolicy(params),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...walletKeys.all, "policies"] }),
    onError: handleError,
  });
}

export function useDeletePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deletePolicy(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...walletKeys.all, "policies"] }),
    onError: handleError,
  });
}

// Signed intents

export function useSignedIntents(intentId?: string, principalDid?: string) {
  return useQuery({
    queryKey: walletKeys.signedIntents(intentId, principalDid),
    queryFn: () => client.listSignedIntents({ intentId, principalDid }),
  });
}

export function useSignIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SignIntentInput) => client.signIntent(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...walletKeys.all, "signed-intents"] }),
    onError: handleError,
  });
}

export function useVerifySignedIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.verifySignedIntent(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...walletKeys.all, "signed-intents"] }),
    onError: handleError,
  });
}
