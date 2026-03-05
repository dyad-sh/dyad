/**
 * Multi-Armed Bandit IPC Handlers
 * Connect renderer to the MAB learning engine
 */

import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { mabEngine } from "../../lib/mab_engine";
import type {
  MABDomain,
  CreateArmParams,
  RecordRewardParams,
  SelectArmParams,
  MABDecayConfig,
} from "../../types/mab_types";

const logger = log.scope("mab_handlers");
const handle = createLoggedHandler(logger);

export function registerMABHandlers(): void {
  logger.info("Registering Multi-Armed Bandit IPC handlers");

  // Start auto-decay (every 6 hours)
  mabEngine.startAutoDecay();

  // ---------------------------------------------------------------------------
  // ARM CRUD
  // ---------------------------------------------------------------------------

  handle("mab:arm:create", async (_event, params: CreateArmParams) => {
    return mabEngine.createArm(params);
  });

  handle("mab:arm:get", async (_event, id: string) => {
    return mabEngine.getArm(id);
  });

  handle("mab:arm:list", async (_event, filters?: {
    domain?: MABDomain;
    contextKey?: string;
    activeOnly?: boolean;
  }) => {
    return mabEngine.listArms(filters);
  });

  handle("mab:arm:update", async (_event, id: string, updates: Partial<{
    name: string;
    description: string;
    isActive: boolean;
    metadata: Record<string, unknown>;
  }>) => {
    return mabEngine.updateArm(id, updates);
  });

  handle("mab:arm:delete", async (_event, id: string) => {
    await mabEngine.deleteArm(id);
  });

  handle("mab:arm:reset", async (_event, id: string) => {
    return mabEngine.resetArm(id);
  });

  handle("mab:arm:get-or-create", async (_event, params: CreateArmParams) => {
    return mabEngine.getOrCreateArm(params);
  });

  // ---------------------------------------------------------------------------
  // ARM SELECTION (THOMPSON SAMPLING)
  // ---------------------------------------------------------------------------

  handle("mab:select", async (_event, params: SelectArmParams) => {
    return mabEngine.selectArm(params);
  });

  // ---------------------------------------------------------------------------
  // REWARD RECORDING
  // ---------------------------------------------------------------------------

  handle("mab:reward", async (_event, params: RecordRewardParams) => {
    return mabEngine.recordReward(params);
  });

  handle("mab:reward:by-name", async (
    _event,
    domain: MABDomain,
    contextKey: string,
    armName: string,
    reward: number,
    opts?: { context?: Record<string, unknown>; feedback?: string; source?: "auto" | "user" | "system" },
  ) => {
    return mabEngine.recordRewardByName(domain, contextKey, armName, reward, opts);
  });

  handle("mab:reward:history", async (_event, armId: string, limit?: number) => {
    return mabEngine.getRewardHistory(armId, limit);
  });

  handle("mab:reward:recent", async (_event, limit?: number) => {
    return mabEngine.getRecentEvents(limit);
  });

  // ---------------------------------------------------------------------------
  // DECAY
  // ---------------------------------------------------------------------------

  handle("mab:decay:apply", async (_event, domain?: MABDomain) => {
    const count = await mabEngine.applyDecay(domain);
    return { decayed: count };
  });

  handle("mab:decay:get-config", async (_event, domain: MABDomain) => {
    return mabEngine.getDecayConfig(domain);
  });

  handle("mab:decay:set-config", async (_event, domain: MABDomain, config: Partial<MABDecayConfig>) => {
    return mabEngine.setDecayConfig(domain, config);
  });

  // ---------------------------------------------------------------------------
  // STATS & CONTEXT KEYS
  // ---------------------------------------------------------------------------

  handle("mab:stats", async () => {
    return mabEngine.getStats();
  });

  handle("mab:context-keys", async () => {
    return mabEngine.listContextKeys();
  });
}
