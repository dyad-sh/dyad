// =============================================================================
// MAB Learning IPC Client — Renderer-side API for multi-armed bandit learning
// =============================================================================

import type {
  MABArm,
  MABRewardEvent,
  MABStats,
  MABDomain,
  MABDecayConfig,
  CreateArmParams,
  RecordRewardParams,
  SelectArmParams,
  SelectArmResult,
} from "../../types/mab_types";

/**
 * Singleton IPC client for the Multi-Armed Bandit learning system.
 * Access via MABClient.getInstance()
 */
export class MABClient {
  private static instance: MABClient;

  static getInstance(): MABClient {
    if (!MABClient.instance) {
      MABClient.instance = new MABClient();
    }
    return MABClient.instance;
  }

  private invoke(channel: string, ...args: unknown[]): Promise<any> {
    return window.electron.ipcRenderer.invoke(channel, ...args);
  }

  // ---- Arm CRUD ----

  createArm(params: CreateArmParams): Promise<MABArm> {
    return this.invoke("mab:arm:create", params);
  }

  getArm(id: string): Promise<MABArm | null> {
    return this.invoke("mab:arm:get", id);
  }

  listArms(filters?: {
    domain?: MABDomain;
    contextKey?: string;
    activeOnly?: boolean;
  }): Promise<MABArm[]> {
    return this.invoke("mab:arm:list", filters);
  }

  updateArm(id: string, updates: Partial<{
    name: string;
    description: string;
    isActive: boolean;
    metadata: Record<string, unknown>;
  }>): Promise<MABArm | null> {
    return this.invoke("mab:arm:update", id, updates);
  }

  deleteArm(id: string): Promise<void> {
    return this.invoke("mab:arm:delete", id);
  }

  resetArm(id: string): Promise<MABArm | null> {
    return this.invoke("mab:arm:reset", id);
  }

  getOrCreateArm(params: CreateArmParams): Promise<MABArm> {
    return this.invoke("mab:arm:get-or-create", params);
  }

  // ---- Arm Selection (Thompson Sampling) ----

  selectArm(params: SelectArmParams): Promise<SelectArmResult> {
    return this.invoke("mab:select", params);
  }

  // ---- Reward Recording ----

  recordReward(params: RecordRewardParams): Promise<MABRewardEvent> {
    return this.invoke("mab:reward", params);
  }

  recordRewardByName(
    domain: MABDomain,
    contextKey: string,
    armName: string,
    reward: number,
    opts?: { context?: Record<string, unknown>; feedback?: string; source?: "auto" | "user" | "system" },
  ): Promise<MABRewardEvent> {
    return this.invoke("mab:reward:by-name", domain, contextKey, armName, reward, opts);
  }

  getRewardHistory(armId: string, limit?: number): Promise<MABRewardEvent[]> {
    return this.invoke("mab:reward:history", armId, limit);
  }

  getRecentEvents(limit?: number): Promise<MABRewardEvent[]> {
    return this.invoke("mab:reward:recent", limit);
  }

  // ---- Decay ----

  applyDecay(domain?: MABDomain): Promise<{ decayed: number }> {
    return this.invoke("mab:decay:apply", domain);
  }

  getDecayConfig(domain: MABDomain): Promise<MABDecayConfig | null> {
    return this.invoke("mab:decay:get-config", domain);
  }

  setDecayConfig(domain: MABDomain, config: Partial<MABDecayConfig>): Promise<MABDecayConfig> {
    return this.invoke("mab:decay:set-config", domain, config);
  }

  // ---- Stats & Context Keys ----

  getStats(): Promise<MABStats> {
    return this.invoke("mab:stats");
  }

  listContextKeys(): Promise<string[]> {
    return this.invoke("mab:context-keys");
  }
}
