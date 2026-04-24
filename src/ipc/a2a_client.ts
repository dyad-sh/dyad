/**
 * Agent-to-Agent (A2A) Economy IPC Client (renderer-side)
 *
 * Singleton; access via `A2aClient.getInstance()`.
 * One method per IPC channel registered in `src/ipc/handlers/a2a_handlers.ts`.
 *
 * Per AGENTS.md, these are intended to be wrapped in TanStack Query hooks
 * (see `src/hooks/use_a2a.ts`).
 */

import type { IpcRenderer } from "electron";
import type {
  A2AContractRow,
  A2AContractState,
  A2ACurrency,
  A2AInvocationRow,
  A2AQuoteRow,
  AgentPrincipalRow,
  AgentServiceListingRow,
} from "@/db/a2a_schema";

export interface PrincipalBudget {
  dailyCap: string;
  perTaskCap: string;
  currency: A2ACurrency;
}

export interface CreateListingInput {
  principalId: string;
  name: string;
  description?: string;
  capability: string;
  tags?: string[];
  pricingModel: AgentServiceListingRow["pricingModel"];
  priceAmount: string;
  currency: A2ACurrency;
  maxLatencyMs?: number;
  successRatePromised?: number;
  inputSchemaJson?: Record<string, unknown> | null;
  outputSchemaJson?: Record<string, unknown> | null;
}

export type ListingPatch = Partial<
  Pick<
    AgentServiceListingRow,
    | "name"
    | "description"
    | "tags"
    | "pricingModel"
    | "priceAmount"
    | "currency"
    | "maxLatencyMs"
    | "successRatePromised"
    | "inputSchemaJson"
    | "outputSchemaJson"
    | "status"
  >
>;

export interface ListingFilters {
  principalId?: string;
  capability?: string;
  status?: AgentServiceListingRow["status"];
}

export interface ContractFilters {
  callerPrincipalId?: string;
  providerPrincipalId?: string;
  state?: A2AContractState | A2AContractState[];
  limit?: number;
}

export interface RequestQuoteInput {
  listingId: string;
  callerPrincipalId: string;
  inputSummary?: string;
  inputJson?: Record<string, unknown> | null;
  estimatedTokens?: number;
  ttlMs?: number;
}

type ElectronWindow = Window & {
  electron?: { ipcRenderer?: IpcRenderer };
};

class A2aClientImpl {
  private static instance: A2aClientImpl | undefined;
  private readonly ipcRenderer: IpcRenderer;

  private constructor() {
    const w = window as unknown as ElectronWindow;
    const renderer = w.electron?.ipcRenderer;
    if (!renderer) {
      throw new Error("A2aClient: window.electron.ipcRenderer is not available");
    }
    this.ipcRenderer = renderer;
  }

  static getInstance(): A2aClientImpl {
    if (!A2aClientImpl.instance) {
      A2aClientImpl.instance = new A2aClientImpl();
    }
    return A2aClientImpl.instance;
  }

  // ── Principals ───────────────────────────────────────────────────────────

  getOrCreatePrincipal(params: {
    agentId: number;
    displayName?: string;
    budget?: PrincipalBudget;
    payoutWallet?: string;
  }): Promise<AgentPrincipalRow> {
    return this.ipcRenderer.invoke("a2a:principal:get-or-create", params);
  }

  listPrincipals(): Promise<AgentPrincipalRow[]> {
    return this.ipcRenderer.invoke("a2a:principal:list");
  }

  setPrincipalBudget(params: {
    principalId: string;
    dailyCap: string;
    perTaskCap: string;
    currency: A2ACurrency;
  }): Promise<AgentPrincipalRow> {
    return this.ipcRenderer.invoke("a2a:principal:set-budget", params);
  }

  // ── Listings ─────────────────────────────────────────────────────────────

  createListing(input: CreateListingInput): Promise<AgentServiceListingRow> {
    return this.ipcRenderer.invoke("a2a:listing:create", input);
  }

  listListings(filters: ListingFilters = {}): Promise<AgentServiceListingRow[]> {
    return this.ipcRenderer.invoke("a2a:listing:list", filters);
  }

  updateListing(params: { id: string; patch: ListingPatch }): Promise<AgentServiceListingRow> {
    return this.ipcRenderer.invoke("a2a:listing:update", params);
  }

  deleteListing(id: string): Promise<{ id: string; deleted: true }> {
    return this.ipcRenderer.invoke("a2a:listing:delete", id);
  }

  // ── Quotes ───────────────────────────────────────────────────────────────

  requestQuote(input: RequestQuoteInput): Promise<A2AQuoteRow> {
    return this.ipcRenderer.invoke("a2a:quote:request", input);
  }

  acceptQuote(quoteId: string): Promise<A2AContractRow> {
    return this.ipcRenderer.invoke("a2a:quote:accept", quoteId);
  }

  // ── Contracts ────────────────────────────────────────────────────────────

  listContracts(filters: ContractFilters = {}): Promise<A2AContractRow[]> {
    return this.ipcRenderer.invoke("a2a:contract:list", filters);
  }

  getContract(id: string): Promise<A2AContractRow> {
    return this.ipcRenderer.invoke("a2a:contract:get", id);
  }

  refundContract(params: { contractId: string; note?: string }): Promise<A2AContractRow> {
    return this.ipcRenderer.invoke("a2a:contract:refund", params);
  }

  // ── Invocations ──────────────────────────────────────────────────────────

  invoke(params: {
    contractId: string;
    input?: Record<string, unknown> | null;
  }): Promise<A2AInvocationRow> {
    return this.ipcRenderer.invoke("a2a:invoke", params);
  }

  verifyInvocation(params: {
    invocationId: string;
    verdict: "accept" | "reject";
    note?: string;
    evidenceJson?: Record<string, unknown> | null;
  }): Promise<A2AInvocationRow> {
    return this.ipcRenderer.invoke("a2a:invocation:verify", params);
  }

  listInvocations(contractId: string): Promise<A2AInvocationRow[]> {
    return this.ipcRenderer.invoke("a2a:invocation:list", contractId);
  }

  // ── Receipts ─────────────────────────────────────────────────────────────

  pinReceipt(invocationId: string): Promise<A2AInvocationRow> {
    return this.ipcRenderer.invoke("a2a:receipt:pin", invocationId);
  }
}

export const A2aClient = A2aClientImpl;
export type A2aClientType = A2aClientImpl;
