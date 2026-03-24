/**
 * Electron stub for web builds.
 *
 * This file is aliased to "electron" in vite.web.config.mts so that any
 * accidental import of electron in the browser bundle gets this no-op instead
 * of crashing with a module-not-found error.
 *
 * Handlers that need Electron APIs should guard with process.versions?.electron.
 */

export const ipcMain = {};
export const ipcRenderer = {};
export const app = {};
export const BrowserWindow = {};
export const dialog = {};
export const protocol = {};
export const net = {};
export const Menu = {};
export const shell = {};
export const contextBridge = {};
export const webFrame = {};
export default {};
