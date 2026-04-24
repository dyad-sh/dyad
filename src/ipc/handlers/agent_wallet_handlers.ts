/**
 * Agent Wallet & Policy IPC Handlers — Tier 2
 *
 * Channels (15):
 *   Capabilities: wallet:capability:issue, wallet:capability:revoke,
 *                 wallet:capability:list, wallet:capability:get,
 *                 wallet:capability:check
 *   Policies:     wallet:policy:create, wallet:policy:update,
 *                 wallet:policy:delete, wallet:policy:list,
 *                 wallet:policy:evaluate
 *   Signed intents: wallet:intent:sign, wallet:intent:verify,
 *                   wallet:intent:list
 *   Misc:         wallet:identity:create-for-principal
 */

import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";

import {
  createPolicy,
  deletePolicy,
  evaluatePolicy,
  getCapability,
  issueCapability,
  listCapabilities,
  listPolicies,
  listSignedIntents,
  principalHasCapability,
  revokeCapability,
  signIntent,
  updatePolicy,
  verifySignedIntent,
  type CapabilityFilters,
  type CreatePolicyInput,
  type IssueCapabilityInput,
  type PolicyContext,
  type PolicyFilters,
  type PolicyPatch,
  type SignIntentInput,
} from "@/lib/agent_wallet";

const logger = log.scope("agent_wallet_handlers");
const handle = createLoggedHandler(logger);

export function registerAgentWalletHandlers(): void {
  // ── Capabilities ──────────────────────────────────────────────────────────

  handle("wallet:capability:issue", async (_e, input: IssueCapabilityInput) => {
    if (!input?.principalId)
      throw new Error("wallet:capability:issue: principalId required");
    if (!input?.capability)
      throw new Error("wallet:capability:issue: capability required");
    return await issueCapability(input);
  });

  handle(
    "wallet:capability:revoke",
    async (_e, params: { id: string; reason?: string }) => {
      if (!params?.id) throw new Error("wallet:capability:revoke: id required");
      return await revokeCapability(params.id, params.reason);
    },
  );

  handle(
    "wallet:capability:list",
    async (_e, filters?: CapabilityFilters) => {
      return await listCapabilities(filters ?? {});
    },
  );

  handle("wallet:capability:get", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("wallet:capability:get: id required");
    return await getCapability(params.id);
  });

  handle(
    "wallet:capability:check",
    async (_e, params: { principalId: string; capability: string }) => {
      if (!params?.principalId || !params?.capability)
        throw new Error(
          "wallet:capability:check: principalId and capability required",
        );
      const has = await principalHasCapability(
        params.principalId,
        params.capability,
      );
      return { has };
    },
  );

  // ── Policies ──────────────────────────────────────────────────────────────

  handle("wallet:policy:create", async (_e, input: CreatePolicyInput) => {
    if (!input?.principalId || !input?.name || !input?.ruleType)
      throw new Error(
        "wallet:policy:create: principalId, name, ruleType required",
      );
    return await createPolicy(input);
  });

  handle(
    "wallet:policy:update",
    async (_e, params: { id: string; patch: PolicyPatch }) => {
      if (!params?.id) throw new Error("wallet:policy:update: id required");
      return await updatePolicy(params.id, params.patch ?? {});
    },
  );

  handle("wallet:policy:delete", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("wallet:policy:delete: id required");
    await deletePolicy(params.id);
    return { ok: true };
  });

  handle("wallet:policy:list", async (_e, filters?: PolicyFilters) => {
    return await listPolicies(filters ?? {});
  });

  handle("wallet:policy:evaluate", async (_e, ctx: PolicyContext) => {
    if (!ctx?.principalId || !ctx?.capability)
      throw new Error(
        "wallet:policy:evaluate: principalId and capability required",
      );
    return await evaluatePolicy(ctx);
  });

  // ── Signed intents ────────────────────────────────────────────────────────

  handle("wallet:intent:sign", async (_e, input: SignIntentInput) => {
    if (!input?.intentId || !input?.principalDid || !input?.privateKeyHex)
      throw new Error(
        "wallet:intent:sign: intentId, principalDid, privateKeyHex required",
      );
    return await signIntent(input);
  });

  handle("wallet:intent:verify", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("wallet:intent:verify: id required");
    return await verifySignedIntent(params.id);
  });

  handle(
    "wallet:intent:list",
    async (
      _e,
      filters: { intentId?: string; principalDid?: string; limit?: number } = {},
    ) => {
      return await listSignedIntents(filters);
    },
  );
}
