/**
 * IPC Handlers for Design System Generator
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  getDesignSystemGenerator,
  type DesignSystemId,
  type ComponentId,
  type GenerateSystemParams,
  type GenerateComponentParams,
  type ExportOptions,
  type DesignTokens,
  type Component,
  type DesignSystemEvent,
} from "../../lib/design_system_generator.js";

// Store event callbacks for cleanup
const eventCallbacks = new Map<string, (event: DesignSystemEvent) => void>();

export function registerDesignSystemHandlers(): void {
  const generator = getDesignSystemGenerator();

  // Initialize
  ipcMain.handle("design-system:initialize", async () => {
    await generator.initialize();
  });

  // ---------------------------------------------------------------------------
  // SYSTEM MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "design-system:create",
    async (_event: IpcMainInvokeEvent, params: GenerateSystemParams) => {
      return generator.createSystem(params);
    }
  );

  ipcMain.handle(
    "design-system:generate",
    async (_event: IpcMainInvokeEvent, systemId: DesignSystemId) => {
      return generator.generateSystem(systemId);
    }
  );

  ipcMain.handle(
    "design-system:get",
    async (_event: IpcMainInvokeEvent, systemId: DesignSystemId) => {
      return generator.getSystem(systemId);
    }
  );

  ipcMain.handle("design-system:list", async () => {
    return generator.listSystems();
  });

  ipcMain.handle(
    "design-system:delete",
    async (_event: IpcMainInvokeEvent, systemId: DesignSystemId) => {
      await generator.deleteSystem(systemId);
    }
  );

  ipcMain.handle(
    "design-system:update-tokens",
    async (_event: IpcMainInvokeEvent, systemId: DesignSystemId, tokens: Partial<DesignTokens>) => {
      return generator.updateTokens(systemId, tokens);
    }
  );

  // ---------------------------------------------------------------------------
  // COMPONENT MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "design-system:generate-component",
    async (_event: IpcMainInvokeEvent, params: GenerateComponentParams) => {
      return generator.generateComponent(params);
    }
  );

  ipcMain.handle(
    "design-system:update-component",
    async (
      _event: IpcMainInvokeEvent,
      systemId: DesignSystemId,
      componentId: ComponentId,
      updates: Partial<Component>
    ) => {
      return generator.updateComponent(systemId, componentId, updates);
    }
  );

  ipcMain.handle(
    "design-system:delete-component",
    async (_event: IpcMainInvokeEvent, systemId: DesignSystemId, componentId: ComponentId) => {
      await generator.deleteComponent(systemId, componentId);
    }
  );

  // ---------------------------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "design-system:export",
    async (_event: IpcMainInvokeEvent, systemId: DesignSystemId, options: ExportOptions) => {
      return generator.exportSystem(systemId, options);
    }
  );

  // ---------------------------------------------------------------------------
  // EVENT SUBSCRIPTION
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "design-system:subscribe",
    async (event: IpcMainInvokeEvent, subscriptionId: string) => {
      const callback = (dsEvent: DesignSystemEvent) => {
        event.sender.send("design-system:event", subscriptionId, dsEvent);
      };

      eventCallbacks.set(subscriptionId, callback);
      generator.subscribe(callback);

      return subscriptionId;
    }
  );

  ipcMain.handle(
    "design-system:unsubscribe",
    async (_event: IpcMainInvokeEvent, subscriptionId: string) => {
      const callback = eventCallbacks.get(subscriptionId);
      if (callback) {
        generator.off("design-system:event", callback);
        eventCallbacks.delete(subscriptionId);
      }
    }
  );
}
