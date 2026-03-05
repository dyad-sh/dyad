/**
 * Multi-Armed Bandit Learning Engine
 * ===================================
 * Thompson Sampling (Beta-Bernoulli) for continuous local-first learning.
 *
 * How it works:
 * 1. Each "arm" represents a strategy/choice (model, prompt, connector…).
 * 2. Arms with the same `contextKey` compete against each other.
 * 3. When the system needs to pick an arm, it samples from each arm's
 *    Beta(alpha, beta) distribution and returns the arm with highest sample.
 * 4. After observing the outcome, a reward in [0, 1] is recorded.
 *    - reward pushes alpha up (success) or beta up (failure).
 * 5. Over time, the engine naturally balances exploration vs exploitation
 *    — poorly-performing arms converge toward low alpha, high beta.
 * 6. Optional time-decay halves old reward weight so the system adapts.
 *
 * Everything is stored in SQLite via drizzle — fully local, zero cloud.
 */

import { randomUUID } from "node:crypto";
import log from "electron-log";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { mabArms, mabRewardEvents, mabDecayConfig } from "../db/mab_schema";
import type {
  MABArm,
  MABRewardEvent,
  MABStats,
  MABDomain,
  CreateArmParams,
  RecordRewardParams,
  SelectArmParams,
  SelectArmResult,
  MABDecayConfig,
} from "../types/mab_types";

const logger = log.scope("mab_engine");

// =============================================================================
// HELPERS
// =============================================================================

/** Sample from Beta(alpha, beta) using the Jöhnk algorithm */
function sampleBeta(a: number, b: number): number {
  // Use gamma sampling: Beta(a,b) = Gamma(a,1) / (Gamma(a,1) + Gamma(b,1))
  const ga = sampleGamma(a);
  const gb = sampleGamma(b);
  if (ga + gb === 0) return 0.5;
  return ga / (ga + gb);
}

/** Sample from Gamma(shape, 1) using Marsaglia & Tsang's method */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Boost shape < 1
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Standard normal via Box-Muller */
function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Convert DB row to MABArm type */
function rowToArm(row: any): MABArm {
  const alpha = row.alpha ?? 1;
  const beta = row.beta ?? 1;
  const pulls = row.pulls ?? 0;
  const meanReward = alpha / (alpha + beta);
  const winRate = pulls > 0 ? (row.totalReward ?? 0) / pulls : 0;
  // Confidence: how much evidence we have (0 = no data, 1 = very converged)
  // Uses the concentration of the Beta distribution: higher α+β → more confident
  const concentration = alpha + beta - 2; // subtract the 2 from uninformative prior
  const confidence = Math.min(1, concentration / 30); // saturates at ~30 observations

  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    description: row.description ?? undefined,
    contextKey: row.contextKey,
    alpha,
    beta,
    pulls,
    totalReward: row.totalReward ?? 0,
    meanReward,
    winRate,
    confidence,
    metadataJson: row.metadataJson ?? null,
    isActive: row.isActive ?? true,
    lastRewardAt: row.lastRewardAt instanceof Date
      ? row.lastRewardAt.getTime()
      : row.lastRewardAt != null
        ? Number(row.lastRewardAt) * 1000
        : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt) * 1000,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : Number(row.updatedAt) * 1000,
  };
}

function rowToEvent(row: any): MABRewardEvent {
  return {
    id: row.id,
    armId: row.armId,
    reward: row.reward,
    contextJson: row.contextJson ?? null,
    feedback: row.feedback ?? undefined,
    source: row.source ?? "auto",
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt) * 1000,
  };
}

// =============================================================================
// CORE ENGINE
// =============================================================================

export class MABEngine {
  private static _instance: MABEngine;
  private decayTimer: ReturnType<typeof setInterval> | null = null;

  static getInstance(): MABEngine {
    if (!MABEngine._instance) MABEngine._instance = new MABEngine();
    return MABEngine._instance;
  }

  /** Start periodic auto-decay (call once from main process startup) */
  startAutoDecay(intervalMs = 6 * 60 * 60 * 1000): void {
    if (this.decayTimer) return;
    this.decayTimer = setInterval(async () => {
      try {
        const count = await this.applyDecay();
        if (count > 0) logger.info(`Auto-decay pass decayed ${count} arms`);
      } catch (err) {
        logger.error("Auto-decay failed", err);
      }
    }, intervalMs);
    logger.info(`MAB auto-decay started (every ${Math.round(intervalMs / 3600000)}h)`);
  }

  /** Stop auto-decay timer */
  stopAutoDecay(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }

  // ---------- ARM CRUD ----------

  async createArm(params: CreateArmParams): Promise<MABArm> {
    const id = randomUUID();
    const now = new Date();
    await db.insert(mabArms).values({
      id,
      domain: params.domain,
      name: params.name,
      description: params.description ?? null,
      contextKey: params.contextKey,
      alpha: 1.0,
      beta: 1.0,
      pulls: 0,
      totalReward: 0,
      metadataJson: params.metadata ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    logger.info(`Created MAB arm "${params.name}" [${params.domain}] ctx=${params.contextKey}`);
    return this.getArm(id) as Promise<MABArm>;
  }

  async getArm(id: string): Promise<MABArm | null> {
    const rows = await db.select().from(mabArms).where(eq(mabArms.id, id)).limit(1);
    return rows.length ? rowToArm(rows[0]) : null;
  }

  async listArms(filters?: {
    domain?: MABDomain;
    contextKey?: string;
    activeOnly?: boolean;
  }): Promise<MABArm[]> {
    let query = db.select().from(mabArms);
    const conditions: any[] = [];
    if (filters?.domain) conditions.push(eq(mabArms.domain, filters.domain));
    if (filters?.contextKey) conditions.push(eq(mabArms.contextKey, filters.contextKey));
    if (filters?.activeOnly !== false) conditions.push(eq(mabArms.isActive, true));
    if (conditions.length === 1) query = query.where(conditions[0]) as any;
    else if (conditions.length > 1) query = query.where(and(...conditions)) as any;
    const rows = await query;
    return rows.map(rowToArm);
  }

  async updateArm(id: string, updates: Partial<{
    name: string;
    description: string;
    isActive: boolean;
    metadata: Record<string, unknown>;
  }>): Promise<MABArm | null> {
    const setValues: any = { updatedAt: new Date() };
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.isActive !== undefined) setValues.isActive = updates.isActive;
    if (updates.metadata !== undefined) setValues.metadataJson = updates.metadata;
    await db.update(mabArms).set(setValues).where(eq(mabArms.id, id));
    return this.getArm(id);
  }

  async deleteArm(id: string): Promise<void> {
    await db.delete(mabArms).where(eq(mabArms.id, id));
    logger.info(`Deleted MAB arm ${id}`);
  }

  /**
   * Get an existing arm by (domain, contextKey, name), or create it.
   * This is the primary integration API — callers don't need to worry
   * about whether the arm already exists.
   */
  async getOrCreateArm(params: CreateArmParams): Promise<MABArm> {
    const existing = await db.select().from(mabArms).where(
      and(
        eq(mabArms.domain, params.domain),
        eq(mabArms.contextKey, params.contextKey),
        eq(mabArms.name, params.name),
      ),
    ).limit(1);
    if (existing.length) return rowToArm(existing[0]);
    return this.createArm(params);
  }

  /**
   * Record a reward by arm name + context key instead of requiring the ID.
   * Useful for integration points that know the arm name but not the UUID.
   */
  async recordRewardByName(
    domain: MABDomain,
    contextKey: string,
    armName: string,
    reward: number,
    opts?: { context?: Record<string, unknown>; feedback?: string; source?: "auto" | "user" | "system" },
  ): Promise<MABRewardEvent> {
    const arm = await this.getOrCreateArm({
      domain,
      name: armName,
      contextKey,
    });
    return this.recordReward({
      armId: arm.id,
      reward,
      context: opts?.context,
      feedback: opts?.feedback,
      source: opts?.source ?? "auto",
    });
  }

  // ---------- ARM SELECTION (THOMPSON SAMPLING) ----------

  async selectArm(params: SelectArmParams): Promise<SelectArmResult> {
    const arms = await this.listArms({
      contextKey: params.contextKey,
      activeOnly: true,
    });
    if (arms.length === 0) {
      throw new Error(`No active arms found for contextKey="${params.contextKey}"`);
    }

    const explorationBonus = Math.max(0.01, params.explorationBonus ?? 1.0);

    // Thompson Sampling: draw from each arm's Beta distribution
    let bestArm = arms[0];
    let bestSample = -Infinity;
    const samples: { arm: MABArm; sample: number }[] = [];

    for (const arm of arms) {
      // Apply exploration bonus by flattening the distribution
      const a = 1 + (arm.alpha - 1) / explorationBonus;
      const b = 1 + (arm.beta - 1) / explorationBonus;
      const sample = sampleBeta(a, b);
      samples.push({ arm, sample });
      if (sample > bestSample) {
        bestSample = sample;
        bestArm = arm;
      }
    }

    // Approximate exploration ratio: how uncertain is the choice?
    const avgSample = samples.reduce((s, x) => s + x.sample, 0) / samples.length;
    const variance = samples.reduce((s, x) => s + (x.sample - avgSample) ** 2, 0) / samples.length;
    const explorationRatio = Math.min(1, Math.sqrt(variance) * 2);

    logger.debug(
      `Thompson selected "${bestArm.name}" (sample=${bestSample.toFixed(3)}) ` +
      `from ${arms.length} arms [ctx=${params.contextKey}]`
    );

    return {
      arm: bestArm,
      sampledValue: bestSample,
      explorationRatio,
    };
  }

  // ---------- REWARD RECORDING ----------

  async recordReward(params: RecordRewardParams): Promise<MABRewardEvent> {
    const arm = await this.getArm(params.armId);
    if (!arm) throw new Error(`Arm ${params.armId} not found`);

    const reward = Math.max(0, Math.min(1, params.reward));
    const eventId = randomUUID();
    const now = new Date();

    // Insert reward event
    await db.insert(mabRewardEvents).values({
      id: eventId,
      armId: params.armId,
      reward,
      contextJson: params.context ?? null,
      feedback: params.feedback ?? null,
      source: params.source ?? "auto",
      createdAt: now,
    });

    // Update arm statistics (Beta distribution update)
    // reward ∈ [0,1] treated as fractional success
    const newAlpha = arm.alpha + reward;
    const newBeta = arm.beta + (1 - reward);
    const newPulls = arm.pulls + 1;
    const newTotalReward = arm.totalReward + reward;

    await db.update(mabArms).set({
      alpha: newAlpha,
      beta: newBeta,
      pulls: newPulls,
      totalReward: newTotalReward,
      lastRewardAt: now,
      updatedAt: now,
    }).where(eq(mabArms.id, params.armId));

    logger.info(
      `Recorded reward ${reward.toFixed(2)} for arm "${arm.name}" ` +
      `(α=${newAlpha.toFixed(1)}, β=${newBeta.toFixed(1)}, pulls=${newPulls})`
    );

    return {
      id: eventId,
      armId: params.armId,
      reward,
      contextJson: params.context ?? null,
      feedback: params.feedback,
      source: params.source ?? "auto",
      createdAt: now.getTime(),
    };
  }

  // ---------- REWARD HISTORY ----------

  async getRewardHistory(armId: string, limit = 50): Promise<MABRewardEvent[]> {
    const rows = await db.select().from(mabRewardEvents)
      .where(eq(mabRewardEvents.armId, armId))
      .orderBy(desc(mabRewardEvents.createdAt))
      .limit(limit);
    return rows.map(rowToEvent);
  }

  async getRecentEvents(limit = 20): Promise<MABRewardEvent[]> {
    const rows = await db.select().from(mabRewardEvents)
      .orderBy(desc(mabRewardEvents.createdAt))
      .limit(limit);
    return rows.map(rowToEvent);
  }

  // ---------- DECAY ----------

  async applyDecay(domain?: MABDomain): Promise<number> {
    // Get decay config
    const configs = domain
      ? await db.select().from(mabDecayConfig).where(eq(mabDecayConfig.domain, domain))
      : await db.select().from(mabDecayConfig).where(eq(mabDecayConfig.enabled, true));

    let totalDecayed = 0;

    for (const cfg of configs) {
      const halfLifeMs = cfg.halfLifeDays * 24 * 60 * 60 * 1000;
      const arms = await this.listArms({ domain: cfg.domain as MABDomain });

      for (const arm of arms) {
        if (arm.pulls < cfg.minPulls) continue;

        // Use lastRewardAt (not updatedAt) so metadata edits don't reset decay
        const lastReward = arm.lastRewardAt ?? arm.createdAt;
        const age = Date.now() - lastReward;
        const decayFactor = Math.pow(0.5, age / halfLifeMs);

        if (decayFactor < 0.99) {
          // Blend toward uninformed prior
          const newAlpha = 1 + (arm.alpha - 1) * decayFactor;
          const newBeta = 1 + (arm.beta - 1) * decayFactor;

          await db.update(mabArms).set({
            alpha: newAlpha,
            beta: newBeta,
            updatedAt: new Date(),
          }).where(eq(mabArms.id, arm.id));
          totalDecayed++;
        }
      }
    }

    if (totalDecayed) logger.info(`Decayed ${totalDecayed} arms`);
    return totalDecayed;
  }

  async getDecayConfig(domain: MABDomain): Promise<MABDecayConfig | null> {
    const rows = await db.select().from(mabDecayConfig).where(eq(mabDecayConfig.domain, domain)).limit(1);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      enabled: r.enabled,
      halfLifeDays: r.halfLifeDays,
      minPulls: r.minPulls,
    };
  }

  async setDecayConfig(domain: MABDomain, config: Partial<MABDecayConfig>): Promise<MABDecayConfig> {
    const existing = await db.select().from(mabDecayConfig).where(eq(mabDecayConfig.domain, domain)).limit(1);
    const now = new Date();

    if (existing.length) {
      const setVals: any = { updatedAt: now };
      if (config.enabled !== undefined) setVals.enabled = config.enabled;
      if (config.halfLifeDays !== undefined) setVals.halfLifeDays = config.halfLifeDays;
      if (config.minPulls !== undefined) setVals.minPulls = config.minPulls;
      await db.update(mabDecayConfig).set(setVals).where(eq(mabDecayConfig.domain, domain));
    } else {
      await db.insert(mabDecayConfig).values({
        id: randomUUID(),
        domain,
        enabled: config.enabled ?? true,
        halfLifeDays: config.halfLifeDays ?? 14,
        minPulls: config.minPulls ?? 5,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Re-read from DB to return the actual persisted state
    const saved = await db.select().from(mabDecayConfig).where(eq(mabDecayConfig.domain, domain)).limit(1);
    return {
      enabled: saved[0].enabled,
      halfLifeDays: saved[0].halfLifeDays,
      minPulls: saved[0].minPulls,
    };
  }

  // ---------- RESET ----------

  async resetArm(id: string): Promise<MABArm | null> {
    await db.update(mabArms).set({
      alpha: 1.0,
      beta: 1.0,
      pulls: 0,
      totalReward: 0,
      lastRewardAt: null,
      updatedAt: new Date(),
    }).where(eq(mabArms.id, id));
    // Delete associated reward events
    await db.delete(mabRewardEvents).where(eq(mabRewardEvents.armId, id));
    logger.info(`Reset arm ${id}`);
    return this.getArm(id);
  }

  // ---------- STATS ----------

  async getStats(): Promise<MABStats> {
    const allArms = await this.listArms({ activeOnly: false });

    const totalPulls = allArms.reduce((s, a) => s + a.pulls, 0);
    const totalReward = allArms.reduce((s, a) => s + a.totalReward, 0);

    const domainBreakdown: MABStats["domainBreakdown"] = {} as any;
    for (const arm of allArms) {
      if (!domainBreakdown[arm.domain]) {
        domainBreakdown[arm.domain] = { arms: 0, pulls: 0, avgReward: 0 };
      }
      domainBreakdown[arm.domain].arms++;
      domainBreakdown[arm.domain].pulls += arm.pulls;
    }
    // Compute avg reward per domain
    for (const d of Object.keys(domainBreakdown) as MABDomain[]) {
      const domainArms = allArms.filter((a) => a.domain === d);
      const dp = domainBreakdown[d].pulls;
      domainBreakdown[d].avgReward = dp > 0
        ? domainArms.reduce((s, a) => s + a.totalReward, 0) / dp
        : 0;
    }

    // Top 5 arms by mean reward (with at least 3 pulls)
    const topArms = [...allArms]
      .filter((a) => a.pulls >= 3)
      .sort((a, b) => b.meanReward - a.meanReward)
      .slice(0, 5);

    const recentEvents = await this.getRecentEvents(10);

    return {
      totalArms: allArms.length,
      totalPulls,
      totalReward,
      domainBreakdown,
      topArms,
      recentEvents,
    };
  }

  // ---------- CONTEXT KEYS ----------

  async listContextKeys(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ contextKey: mabArms.contextKey })
      .from(mabArms);
    return rows.map((r) => r.contextKey);
  }
}

// Singleton export
export const mabEngine = MABEngine.getInstance();
