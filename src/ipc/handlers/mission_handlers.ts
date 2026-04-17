/**
 * IPC handlers for background mission management.
 *
 * These wrap the BackgroundExecutor + mission persistence layer so the
 * renderer can create, list, pause, resume, and cancel persisted missions.
 */

import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import {
  getMission,
  listMissions,
  cancelMission,
  deleteMission,
  updateMissionMeta,
  type MissionStatus,
  type CreateMissionInput,
} from "@/lib/mission_persistence";
import { backgroundExecutor } from "@/lib/background_executor";

const logger = log.scope("mission_handlers");
const handle = createLoggedHandler(logger);

export function registerMissionHandlers() {
  handle(
    "mission:start",
    async (
      _,
      params: {
        appId?: number;
        agentId?: string;
        title: string;
        description?: string;
        targetAppPath?: string;
        phases?: { name: string }[];
      },
    ) => {
      const input: CreateMissionInput = {
        appId: params.appId,
        agentId: params.agentId,
        title: params.title,
        description: params.description,
        targetAppPath: params.targetAppPath,
        phases: (params.phases ?? []).map((p) => ({
          name: p.name,
          status: "pending" as const,
          actions: 0,
          errors: 0,
        })),
      };
      return backgroundExecutor.startMission(input);
    },
  );

  handle("mission:get", async (_, id: string) => {
    const mission = getMission(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);
    return mission;
  });

  handle(
    "mission:list",
    async (
      _,
      filter?: { status?: MissionStatus | MissionStatus[]; appId?: number },
    ) => {
      return listMissions(filter);
    },
  );

  handle("mission:pause", async (_, id: string) => {
    backgroundExecutor.pauseMission(id);
  });

  handle("mission:resume", async (_, id: string) => {
    await backgroundExecutor.resumeMission(id);
  });

  handle("mission:cancel", async (_, id: string) => {
    backgroundExecutor.cancelMission(id);
  });

  handle("mission:delete", async (_, id: string) => {
    // Cancel first if still running
    const mission = getMission(id);
    if (mission && (mission.status === "running" || mission.status === "paused")) {
      backgroundExecutor.cancelMission(id);
    }
    deleteMission(id);
  });

  handle(
    "mission:update",
    async (_, params: { id: string; title?: string; description?: string }) => {
      updateMissionMeta(params.id, {
        title: params.title,
        description: params.description,
      });
      return getMission(params.id);
    },
  );
}
