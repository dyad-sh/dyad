/**
 * Widget IPC Handlers
 *
 * widget:list, widget:create, widget:update, widget:remove
 * Throw-on-error pattern.
 */

import { ipcMain } from "electron";
import { getWidgetSystem, type WidgetId, type Widget } from "@/lib/widget_system";

export function registerWidgetHandlers(): void {
  const sys = getWidgetSystem();

  ipcMain.handle("widget:initialize", async () => {
    await sys.initialize();
  });

  ipcMain.handle("widget:list", async (_e, container?: string) => {
    await sys.initialize();
    return sys.list(container);
  });

  ipcMain.handle("widget:get", async (_e, id: WidgetId) => {
    await sys.initialize();
    const w = sys.get(id);
    if (!w) throw new Error(`Widget not found: ${id}`);
    return w;
  });

  ipcMain.handle(
    "widget:create",
    async (
      _e,
      params: Parameters<typeof sys.create>[0],
    ): Promise<Widget> => {
      await sys.initialize();
      return sys.create(params);
    },
  );

  ipcMain.handle(
    "widget:update",
    async (
      _e,
      payload: { id: WidgetId; patch: Parameters<typeof sys.update>[1] },
    ): Promise<Widget> => {
      await sys.initialize();
      return sys.update(payload.id, payload.patch);
    },
  );

  ipcMain.handle("widget:remove", async (_e, id: WidgetId) => {
    await sys.initialize();
    sys.remove(id);
  });
}
