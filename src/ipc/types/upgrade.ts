import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Upgrade Schemas
// =============================================================================

export const AppUpgradeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  manualUpgradeUrl: z.string(),
  isNeeded: z.boolean(),
});

export type AppUpgrade = z.infer<typeof AppUpgradeSchema>;

export const GetAppUpgradesParamsSchema = z.object({
  appId: z.number(),
});

export const ExecuteAppUpgradeParamsSchema = z.object({
  appId: z.number(),
  upgradeId: z.string(),
});

// =============================================================================
// Upgrade Contracts
// =============================================================================

export const upgradeContracts = {
  getAppUpgrades: defineContract({
    channel: "get-app-upgrades",
    input: GetAppUpgradesParamsSchema,
    output: z.array(AppUpgradeSchema),
  }),

  executeAppUpgrade: defineContract({
    channel: "execute-app-upgrade",
    input: ExecuteAppUpgradeParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Upgrade Client
// =============================================================================

export const upgradeClient = createClient(upgradeContracts);
