/**
 * Agent-to-Agent (A2A) Economy hooks
 *
 * TanStack Query wrappers around `A2aClient`. Reads use `useQuery`,
 * writes use `useMutation` with cache invalidation, errors surface via toast.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showError } from "@/lib/toast";
import {
  A2aClient,
  type ContractFilters,
  type CreateListingInput,
  type ListingFilters,
  type ListingPatch,
  type PrincipalBudget,
  type RequestQuoteInput,
} from "@/ipc/a2a_client";
import type { A2ACurrency } from "@/db/a2a_schema";

const client = A2aClient.getInstance();

// ── Query keys ──────────────────────────────────────────────────────────────

export const a2aKeys = {
  all: ["a2a"] as const,
  principals: () => [...a2aKeys.all, "principals"] as const,
  listings: (filters?: ListingFilters) =>
    [...a2aKeys.all, "listings", filters ?? {}] as const,
  contracts: (filters?: ContractFilters) =>
    [...a2aKeys.all, "contracts", filters ?? {}] as const,
  contract: (id: string) => [...a2aKeys.all, "contract", id] as const,
  invocations: (contractId: string) =>
    [...a2aKeys.all, "invocations", contractId] as const,
};

const handleError = (error: unknown) => {
  showError(error instanceof Error ? error : new Error(String(error)));
};

// ── Principals ──────────────────────────────────────────────────────────────

export function usePrincipals() {
  return useQuery({
    queryKey: a2aKeys.principals(),
    queryFn: () => client.listPrincipals(),
  });
}

export function useGetOrCreatePrincipal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      agentId: number;
      displayName?: string;
      budget?: PrincipalBudget;
      payoutWallet?: string;
    }) => client.getOrCreatePrincipal(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: a2aKeys.principals() }),
    onError: handleError,
  });
}

export function useSetPrincipalBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      principalId: string;
      dailyCap: string;
      perTaskCap: string;
      currency: A2ACurrency;
    }) => client.setPrincipalBudget(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: a2aKeys.principals() }),
    onError: handleError,
  });
}

// ── Listings ────────────────────────────────────────────────────────────────

export function useListings(filters: ListingFilters = {}) {
  return useQuery({
    queryKey: a2aKeys.listings(filters),
    queryFn: () => client.listListings(filters),
  });
}

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateListingInput) => client.createListing(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...a2aKeys.all, "listings"] }),
    onError: handleError,
  });
}

export function useUpdateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; patch: ListingPatch }) =>
      client.updateListing(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...a2aKeys.all, "listings"] }),
    onError: handleError,
  });
}

export function useDeleteListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteListing(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...a2aKeys.all, "listings"] }),
    onError: handleError,
  });
}

// ── Quotes ──────────────────────────────────────────────────────────────────

export function useRequestQuote() {
  return useMutation({
    mutationFn: (input: RequestQuoteInput) => client.requestQuote(input),
    onError: handleError,
  });
}

export function useAcceptQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: string) => client.acceptQuote(quoteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...a2aKeys.all, "contracts"] }),
    onError: handleError,
  });
}

// ── Contracts ───────────────────────────────────────────────────────────────

export function useContracts(filters: ContractFilters = {}) {
  return useQuery({
    queryKey: a2aKeys.contracts(filters),
    queryFn: () => client.listContracts(filters),
  });
}

export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: a2aKeys.contract(id ?? ""),
    queryFn: () => client.getContract(id as string),
    enabled: Boolean(id),
  });
}

export function useRefundContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { contractId: string; note?: string }) =>
      client.refundContract(params),
    onSuccess: (contract) => {
      qc.invalidateQueries({ queryKey: [...a2aKeys.all, "contracts"] });
      qc.invalidateQueries({ queryKey: a2aKeys.contract(contract.id) });
    },
    onError: handleError,
  });
}

// ── Invocations ─────────────────────────────────────────────────────────────

export function useInvocations(contractId: string | undefined) {
  return useQuery({
    queryKey: a2aKeys.invocations(contractId ?? ""),
    queryFn: () => client.listInvocations(contractId as string),
    enabled: Boolean(contractId),
  });
}

export function useInvoke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      contractId: string;
      input?: Record<string, unknown> | null;
    }) => client.invoke(params),
    onSuccess: (invocation) => {
      qc.invalidateQueries({ queryKey: a2aKeys.invocations(invocation.contractId) });
      qc.invalidateQueries({ queryKey: a2aKeys.contract(invocation.contractId) });
      qc.invalidateQueries({ queryKey: [...a2aKeys.all, "contracts"] });
    },
    onError: handleError,
  });
}

export function useVerifyInvocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      invocationId: string;
      verdict: "accept" | "reject";
      note?: string;
      evidenceJson?: Record<string, unknown> | null;
    }) => client.verifyInvocation(params),
    onSuccess: (invocation) => {
      qc.invalidateQueries({ queryKey: a2aKeys.invocations(invocation.contractId) });
      qc.invalidateQueries({ queryKey: a2aKeys.contract(invocation.contractId) });
      qc.invalidateQueries({ queryKey: [...a2aKeys.all, "contracts"] });
    },
    onError: handleError,
  });
}

// ── Receipts ────────────────────────────────────────────────────────────────

export function usePinReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invocationId: string) => client.pinReceipt(invocationId),
    onSuccess: (invocation) => {
      qc.invalidateQueries({ queryKey: a2aKeys.invocations(invocation.contractId) });
    },
    onError: handleError,
  });
}
