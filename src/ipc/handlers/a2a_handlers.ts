/**
 * Agent-to-Agent (A2A) Economy IPC Handlers
 *
 * Thin wrappers around `@/lib/a2a_economy`. All handlers throw on error
 * (per repo convention in AGENTS.md / CLAUDE.md).
 *
 * Channels (16):
 *   Principals:    a2a:principal:get-or-create, a2a:principal:list,
 *                  a2a:principal:set-budget
 *   Listings:      a2a:listing:create, a2a:listing:list,
 *                  a2a:listing:update, a2a:listing:delete
 *   Quotes:        a2a:quote:request, a2a:quote:accept
 *   Contracts:     a2a:contract:list, a2a:contract:get,
 *                  a2a:contract:refund
 *   Invocations:   a2a:invoke, a2a:invocation:verify,
 *                  a2a:invocation:list
 *   Receipts:      a2a:receipt:pin
 */

import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";

import {
  acceptQuote,
  createListing,
  deleteListing,
  getContract,
  getOrCreatePrincipal,
  invokeContract,
  listContracts,
  listInvocationsForContract,
  listListings,
  listPrincipals,
  pinReceipt,
  refundContract,
  requestQuote,
  setPrincipalBudget,
  updateListing,
  verifyInvocation,
  type CreateListingInput,
  type InvocationExecutor,
  type ListingFilters,
  type ListingPatch,
  type PrincipalBudget,
  type RequestQuoteInput,
  type ContractFilters,
} from "@/lib/a2a_economy";
import type { A2ACurrency } from "@/db/a2a_schema";

const logger = log.scope("a2a_handlers");
const handle = createLoggedHandler(logger);

// =============================================================================
// EXECUTOR REGISTRY
//
// Listings declare a `capability` (e.g. "summarise.text", "image.generate").
// At invoke time we look up an executor for that capability. If none is
// registered, we fall back to an echo executor so the surface still works
// end-to-end during early integration.
//
// To wire MCP / agent_swarm / n8n later, call `registerA2aExecutor(...)`
// from the corresponding integration module.
// =============================================================================

const executors = new Map<string, InvocationExecutor>();

export function registerA2aExecutor(capability: string, executor: InvocationExecutor): void {
  executors.set(capability, executor);
}

export function unregisterA2aExecutor(capability: string): void {
  executors.delete(capability);
}

const echoExecutor: InvocationExecutor = async ({ input }) => ({
  output: { echo: input ?? null, executor: "echo" },
});

function resolveExecutor(capability: string): InvocationExecutor {
  return executors.get(capability) ?? echoExecutor;
}

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerA2aHandlers(): void {
  logger.info("Registering A2A economy handlers...");

  // ── Principals ────────────────────────────────────────────────────────────

  handle(
    "a2a:principal:get-or-create",
    async (
      _,
      params: {
        agentId: number;
        displayName?: string;
        budget?: PrincipalBudget;
        payoutWallet?: string;
      },
    ) => {
      if (!params || typeof params.agentId !== "number") {
        throw new Error("agentId (number) is required");
      }
      return getOrCreatePrincipal(params.agentId, {
        displayName: params.displayName,
        budget: params.budget,
        payoutWallet: params.payoutWallet,
      });
    },
  );

  handle("a2a:principal:list", async () => listPrincipals());

  handle(
    "a2a:principal:set-budget",
    async (
      _,
      params: {
        principalId: string;
        dailyCap: string;
        perTaskCap: string;
        currency: A2ACurrency;
      },
    ) => {
      if (!params?.principalId) throw new Error("principalId is required");
      return setPrincipalBudget(params.principalId, {
        dailyCap: params.dailyCap,
        perTaskCap: params.perTaskCap,
        currency: params.currency,
      });
    },
  );

  // ── Listings ──────────────────────────────────────────────────────────────

  handle("a2a:listing:create", async (_, params: CreateListingInput) => {
    if (!params) throw new Error("listing input is required");
    return createListing(params);
  });

  handle("a2a:listing:list", async (_, filters?: ListingFilters) =>
    listListings(filters ?? {}),
  );

  handle(
    "a2a:listing:update",
    async (_, params: { id: string; patch: ListingPatch }) => {
      if (!params?.id) throw new Error("listing id is required");
      return updateListing(params.id, params.patch ?? {});
    },
  );

  handle("a2a:listing:delete", async (_, id: string) => {
    if (!id) throw new Error("listing id is required");
    await deleteListing(id);
    return { id, deleted: true };
  });

  // ── Quotes ────────────────────────────────────────────────────────────────

  handle("a2a:quote:request", async (_, params: RequestQuoteInput) => {
    if (!params?.listingId) throw new Error("listingId is required");
    if (!params?.callerPrincipalId) throw new Error("callerPrincipalId is required");
    return requestQuote(params);
  });

  handle("a2a:quote:accept", async (_, quoteId: string) => {
    if (!quoteId) throw new Error("quoteId is required");
    return acceptQuote(quoteId);
  });

  // ── Contracts ─────────────────────────────────────────────────────────────

  handle("a2a:contract:list", async (_, filters?: ContractFilters) =>
    listContracts(filters ?? {}),
  );

  handle("a2a:contract:get", async (_, id: string) => {
    if (!id) throw new Error("contract id is required");
    return getContract(id);
  });

  handle(
    "a2a:contract:refund",
    async (_, params: { contractId: string; note?: string }) => {
      if (!params?.contractId) throw new Error("contractId is required");
      return refundContract(params.contractId, params.note);
    },
  );

  // ── Invocations ───────────────────────────────────────────────────────────

  handle(
    "a2a:invoke",
    async (
      _,
      params: { contractId: string; input?: Record<string, unknown> | null },
    ) => {
      if (!params?.contractId) throw new Error("contractId is required");
      const contract = await getContract(params.contractId);
      // Look up the listing's capability to choose an executor.
      // (We re-fetch the listing through the engine so we don't duplicate logic.)
      const { getListing } = await import("@/lib/a2a_economy");
      const listing = await getListing(contract.listingId);
      const executor = resolveExecutor(listing.capability);
      return invokeContract(params.contractId, params.input ?? null, executor);
    },
  );

  handle(
    "a2a:invocation:verify",
    async (
      _,
      params: {
        invocationId: string;
        verdict: "accept" | "reject";
        note?: string;
        evidenceJson?: Record<string, unknown> | null;
      },
    ) => {
      if (!params?.invocationId) throw new Error("invocationId is required");
      if (params.verdict !== "accept" && params.verdict !== "reject") {
        throw new Error("verdict must be 'accept' or 'reject'");
      }
      return verifyInvocation(
        params.invocationId,
        params.verdict,
        params.note,
        params.evidenceJson ?? null,
      );
    },
  );

  handle("a2a:invocation:list", async (_, contractId: string) => {
    if (!contractId) throw new Error("contractId is required");
    return listInvocationsForContract(contractId);
  });

  // ── Receipts ──────────────────────────────────────────────────────────────

  handle("a2a:receipt:pin", async (_, invocationId: string) => {
    if (!invocationId) throw new Error("invocationId is required");
    return pinReceipt(invocationId);
  });

  logger.info("A2A economy handlers registered (16 channels)");
}
