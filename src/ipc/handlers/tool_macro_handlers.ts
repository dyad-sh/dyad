/**
 * Tool Macro IPC Handlers
 *
 * macro:list, macro:create, macro:remove, macro:execute
 */

import { ipcMain } from "electron";
import {
  getToolMacroStore,
  type MacroId,
  type MacroStep,
} from "@/lib/tool_macro";

export function registerToolMacroHandlers(): void {
  const store = getToolMacroStore();

  ipcMain.handle("macro:initialize", async () => {
    await store.initialize();
  });

  ipcMain.handle("macro:list", async () => {
    await store.initialize();
    return store.list();
  });

  ipcMain.handle(
    "macro:create",
    async (
      _e,
      params: { name: string; description?: string; steps: MacroStep[]; ownerId?: string },
    ) => {
      await store.initialize();
      return store.create({
        name: params.name,
        description: params.description,
        steps: params.steps,
        ownerId: params.ownerId ?? "user",
      });
    },
  );

  ipcMain.handle("macro:remove", async (_e, id: MacroId) => {
    await store.initialize();
    store.remove(id);
  });
}
