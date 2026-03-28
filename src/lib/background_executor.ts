/**
 * Background Mission Executor
 *
 * Runs autonomous missions in the Electron main process, persisting
 * progress to SQLite so missions survive app restarts.
 *
 * Key responsibilities:
 * - Pick up pending/interrupted missions
 * - Drive them through phases via AutonomousAgentSystem
 * - Persist state after every phase
 * - Run verification after code-generation phases
 * - Emit progress events for the UI
 */

import { EventEmitter } from "node:events";
import log from "electron-log";
import {
  createMission,
  getMission,
  updateMissionStatus,
  updateMissionPhase,
  appendMissionLog,
  incrementVerifyAttempts,
  getInterruptedMissions,
  type CreateMissionInput,
  type MissionRow,
  type MissionStatus,
} from "@/lib/mission_persistence";
import { type MissionPhaseRow } from "@/db/mission_schema";
import { runVerifyApp, runTests } from "@/lib/autonomous_tool_bridge";

const logger = log.scope("background-executor");

// ============================================================================
// Types
// ============================================================================

export interface MissionProgress {
  missionId: string;
  status: MissionStatus;
  phaseIndex: number;
  phaseName: string;
  totalPhases: number;
  log?: string;
}

// ============================================================================
// BackgroundExecutor (singleton)
// ============================================================================

class BackgroundExecutor extends EventEmitter {
  private static instance: BackgroundExecutor;
  private running = new Map<string, AbortController>();

  static getInstance(): BackgroundExecutor {
    if (!BackgroundExecutor.instance) {
      BackgroundExecutor.instance = new BackgroundExecutor();
    }
    return BackgroundExecutor.instance;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Called at app startup. Resumes any missions that were running
   * when the app was last closed.
   */
  async startup(): Promise<void> {
    const interrupted = getInterruptedMissions();
    if (interrupted.length === 0) return;

    logger.info(
      `Resuming ${interrupted.length} interrupted mission(s)`,
    );

    for (const mission of interrupted) {
      // Don't await — kick them off in parallel
      this.resumeMission(mission.id).catch((err) => {
        logger.error(`Failed to resume mission ${mission.id}:`, err);
      });
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Create and immediately start a new mission.
   */
  async startMission(input: CreateMissionInput): Promise<MissionRow> {
    const mission = createMission(input);
    logger.info(`Created mission ${mission.id}: ${mission.title}`);

    // Start execution without awaiting (fire-and-forget background task)
    this.executeMission(mission.id).catch((err) => {
      logger.error(`Mission ${mission.id} failed:`, err);
    });

    return mission;
  }

  /**
   * Resume a previously interrupted or paused mission.
   */
  async resumeMission(id: string): Promise<void> {
    const mission = getMission(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);

    if (mission.status !== "running" && mission.status !== "paused") {
      throw new Error(`Cannot resume mission in status: ${mission.status}`);
    }

    updateMissionStatus(id, "running");
    this.executeMission(id).catch((err) => {
      logger.error(`Mission ${id} failed on resume:`, err);
    });
  }

  /**
   * Pause a running mission after the current phase completes.
   */
  pauseMission(id: string): void {
    const ac = this.running.get(id);
    if (ac) {
      ac.abort();
      this.running.delete(id);
    }
    updateMissionStatus(id, "paused");
    this.emitProgress(id);
  }

  /**
   * Cancel a mission permanently.
   */
  cancelMission(id: string): void {
    const ac = this.running.get(id);
    if (ac) {
      ac.abort();
      this.running.delete(id);
    }
    updateMissionStatus(id, "cancelled");
    this.emitProgress(id);
  }

  // --------------------------------------------------------------------------
  // Core execution loop
  // --------------------------------------------------------------------------

  private async executeMission(id: string): Promise<void> {
    const ac = new AbortController();
    this.running.set(id, ac);

    try {
      updateMissionStatus(id, "running");
      this.emitProgress(id);

      let mission = getMission(id);
      if (!mission) throw new Error(`Mission ${id} disappeared`);

      const phases = mission.phases ?? [];
      const startPhase = mission.currentPhaseIndex ?? 0;

      for (let i = startPhase; i < phases.length; i++) {
        if (ac.signal.aborted) {
          logger.info(`Mission ${id} aborted at phase ${i}`);
          return;
        }

        const phase = phases[i];
        phase.status = "running";
        phase.startedAt = Date.now();
        updateMissionPhase(id, i, phases);
        this.emitProgress(id);

        appendMissionLog(id, `[Phase ${i}] Starting: ${phase.name}`);

        try {
          await this.executePhase(id, phase, mission.targetAppPath);
          phase.status = "completed";
          phase.completedAt = Date.now();
        } catch (err) {
          phase.status = "failed";
          phase.errors += 1;
          phase.completedAt = Date.now();
          const msg = err instanceof Error ? err.message : String(err);
          appendMissionLog(id, `[Phase ${i}] Error: ${msg}`);
        }

        updateMissionPhase(id, i, phases);
        this.emitProgress(id);

        // Verify after code-gen phases
        if (
          mission.targetAppPath &&
          (phase.name.includes("code") ||
            phase.name.includes("generate") ||
            phase.name.includes("build"))
        ) {
          await this.verifyAfterPhase(id, mission.targetAppPath);
        }
      }

      // All phases done
      const allPassed = phases.every(
        (p) => p.status === "completed" || p.status === "skipped",
      );
      updateMissionStatus(id, allPassed ? "completed" : "failed", {
        completedAt: new Date(),
        lastError: allPassed
          ? undefined
          : phases.find((p) => p.status === "failed")?.name,
      });
      this.emitProgress(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Mission ${id} executor error: ${msg}`);
      updateMissionStatus(id, "failed", { lastError: msg });
      this.emitProgress(id);
    } finally {
      this.running.delete(id);
    }
  }

  // --------------------------------------------------------------------------
  // Phase execution (placeholder — will be wired to AutonomousAgentSystem)
  // --------------------------------------------------------------------------

  /**
   * Execute a single mission phase.
   * Currently a stub that logs the phase and waits briefly.
   * In the full implementation, this calls into AutonomousAgentSystem.executePhase().
   */
  private async executePhase(
    missionId: string,
    phase: MissionPhaseRow,
    _targetAppPath: string | null,
  ): Promise<void> {
    appendMissionLog(missionId, `Executing phase: ${phase.name}`);
    // Actual phase dispatch will be wired in Step 10 (full integration)
    // For now, mark as complete after a beat
    await new Promise((r) => setTimeout(r, 500));
    phase.actions += 1;
  }

  // --------------------------------------------------------------------------
  // Verification
  // --------------------------------------------------------------------------

  private async verifyAfterPhase(
    missionId: string,
    appPath: string,
  ): Promise<void> {
    incrementVerifyAttempts(missionId);
    appendMissionLog(missionId, "Running post-phase verification…");

    try {
      const result = await runVerifyApp({ appPath });
      appendMissionLog(missionId, `Verification result: ${result.substring(0, 500)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendMissionLog(missionId, `Verification error: ${msg}`);
    }
  }

  // --------------------------------------------------------------------------
  // Progress events
  // --------------------------------------------------------------------------

  private emitProgress(missionId: string): void {
    const mission = getMission(missionId);
    if (!mission) return;
    const phases = mission.phases ?? [];
    const idx = mission.currentPhaseIndex ?? 0;

    const progress: MissionProgress = {
      missionId,
      status: mission.status as MissionStatus,
      phaseIndex: idx,
      phaseName: phases[idx]?.name ?? "",
      totalPhases: phases.length,
      log: mission.log ?? undefined,
    };

    this.emit("mission:progress", progress);
  }
}

export const backgroundExecutor = BackgroundExecutor.getInstance();
