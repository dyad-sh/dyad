/**
 * Scheduler IPC Handlers
 *
 * scheduler:list, scheduler:create, scheduler:remove, scheduler:set-enabled
 * Throw-on-error pattern.
 *
 * Wiring of the dispatcher (cron tick → tool invocation) is performed by the
 * local agent module after its tool registry is initialized.
 */

import { ipcMain } from "electron";
import { getSchedulerService, type ScheduleId } from "@/lib/scheduler_service";

export function registerSchedulerHandlers(): void {
  const sys = getSchedulerService();

  ipcMain.handle("scheduler:initialize", async () => {
    await sys.initialize();
  });

  ipcMain.handle("scheduler:list", async () => {
    await sys.initialize();
    return sys.list();
  });

  ipcMain.handle(
    "scheduler:create",
    async (
      _e,
      params: Parameters<typeof sys.create>[0],
    ) => {
      await sys.initialize();
      return sys.create(params);
    },
  );

  ipcMain.handle("scheduler:remove", async (_e, id: ScheduleId) => {
    await sys.initialize();
    sys.remove(id);
  });

  ipcMain.handle(
    "scheduler:set-enabled",
    async (_e, payload: { id: ScheduleId; enabled: boolean }) => {
      await sys.initialize();
      sys.setEnabled(payload.id, payload.enabled);
    },
  );
}
