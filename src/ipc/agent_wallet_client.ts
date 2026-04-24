/**
 * Agent Wallet & Policy IPC Client (renderer-side) — Tier 2.
 */

import type { IpcRenderer } from "electron";
import type {
  AgentCapabilityRow,
  AgentPolicyRow,
  CapabilityStatus,
  PolicyRuleType,
  PolicyStatus,
  SignatureAlgorithm,
  SignedIntentRow,
  WalletCurrency,
} from "@/db/agent_wallet_schema";

export interface IssueCapabilityInput {
  principalId: string;
  capability: string;
  scope?: string;
  conditions?: Record<string, unknown> | null;
  issuedBy?: string;
  expiresAt?: Date | null;
}

export interface CapabilityFilters {
  principalId?: string;
  capability?: string;
  status?: CapabilityStatus;
}

export interface CreatePolicyInput {
  principalId: string;
  name: string;
  ruleType: PolicyRuleType;
  pattern?: string;
  maxAmount?: string;
  currency?: WalletCurrency;
  windowSeconds?: number;
  timeWindowStart?: number;
  timeWindowEnd?: number;
  priority?: number;
  notes?: string;
}

export type PolicyPatch = Partial<
  Pick<
    AgentPolicyRow,
    | "name"
    | "pattern"
    | "maxAmount"
    | "currency"
    | "windowSeconds"
    | "timeWindowStart"
    | "timeWindowEnd"
    | "priority"
    | "status"
    | "notes"
  >
>;

export interface PolicyFilters {
  principalId?: string;
  status?: PolicyStatus;
}

export interface PolicyContext {
  principalId: string;
  capability: string;
  amount?: string;
  currency?: WalletCurrency;
  at?: Date;
}

export interface PolicyDecision {
  allowed: boolean;
  reasons: string[];
  requiresHumanVerify: boolean;
}

export interface SignIntentInput {
  intentId: string;
  principalDid: string;
  privateKeyHex: string;
  algorithm?: SignatureAlgorithm;
}

type ElectronWindow = Window & {
  electron?: { ipcRenderer?: IpcRenderer };
};

class AgentWalletClientImpl {
  private static instance: AgentWalletClientImpl | undefined;
  private readonly ipcRenderer: IpcRenderer;

  private constructor() {
    const w = window as unknown as ElectronWindow;
    const renderer = w.electron?.ipcRenderer;
    if (!renderer)
      throw new Error(
        "AgentWalletClient: window.electron.ipcRenderer is not available",
      );
    this.ipcRenderer = renderer;
  }

  static getInstance(): AgentWalletClientImpl {
    if (!AgentWalletClientImpl.instance) {
      AgentWalletClientImpl.instance = new AgentWalletClientImpl();
    }
    return AgentWalletClientImpl.instance;
  }

  // Capabilities
  issueCapability(input: IssueCapabilityInput): Promise<AgentCapabilityRow> {
    return this.ipcRenderer.invoke("wallet:capability:issue", input);
  }

  revokeCapability(params: {
    id: string;
    reason?: string;
  }): Promise<AgentCapabilityRow> {
    return this.ipcRenderer.invoke("wallet:capability:revoke", params);
  }

  listCapabilities(
    filters: CapabilityFilters = {},
  ): Promise<AgentCapabilityRow[]> {
    return this.ipcRenderer.invoke("wallet:capability:list", filters);
  }

  getCapability(id: string): Promise<AgentCapabilityRow | null> {
    return this.ipcRenderer.invoke("wallet:capability:get", { id });
  }

  checkCapability(params: {
    principalId: string;
    capability: string;
  }): Promise<{ has: boolean }> {
    return this.ipcRenderer.invoke("wallet:capability:check", params);
  }

  // Policies
  createPolicy(input: CreatePolicyInput): Promise<AgentPolicyRow> {
    return this.ipcRenderer.invoke("wallet:policy:create", input);
  }

  updatePolicy(params: {
    id: string;
    patch: PolicyPatch;
  }): Promise<AgentPolicyRow> {
    return this.ipcRenderer.invoke("wallet:policy:update", params);
  }

  deletePolicy(id: string): Promise<{ ok: true }> {
    return this.ipcRenderer.invoke("wallet:policy:delete", { id });
  }

  listPolicies(filters: PolicyFilters = {}): Promise<AgentPolicyRow[]> {
    return this.ipcRenderer.invoke("wallet:policy:list", filters);
  }

  evaluatePolicy(ctx: PolicyContext): Promise<PolicyDecision> {
    return this.ipcRenderer.invoke("wallet:policy:evaluate", ctx);
  }

  // Signed intents
  signIntent(input: SignIntentInput): Promise<SignedIntentRow> {
    return this.ipcRenderer.invoke("wallet:intent:sign", input);
  }

  verifySignedIntent(id: string): Promise<SignedIntentRow> {
    return this.ipcRenderer.invoke("wallet:intent:verify", { id });
  }

  listSignedIntents(
    filters: { intentId?: string; principalDid?: string; limit?: number } = {},
  ): Promise<SignedIntentRow[]> {
    return this.ipcRenderer.invoke("wallet:intent:list", filters);
  }
}

export const AgentWalletClient = AgentWalletClientImpl;
