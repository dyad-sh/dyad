import type { IpcMainInvokeEvent } from "electron";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "@/db/schema";
import type { UserSettings, App } from "@/ipc/ipc_types";
import type log from "electron-log";

/**
 * Extension capabilities declaration
 */
export interface ExtensionCapabilities {
  /** Extension has main process code */
  hasMainProcess: boolean;
  /** Extension has renderer process code */
  hasRendererProcess: boolean;
  /** Extension requires database schema changes */
  hasDatabaseSchema: boolean;
  /** Extension requires settings schema changes */
  hasSettingsSchema: boolean;
  /** IPC channels this extension will register (for validation) */
  ipcChannels?: string[];
}

/**
 * UI integration points for extensions
 */
export interface ExtensionUI {
  /** Settings page integration */
  settingsPage?: {
    /** Component name to render in settings */
    component: string;
    /** Title to display */
    title: string;
    /** Optional icon identifier */
    icon?: string;
  };
  /** App connector integration (shows in app detail view) */
  appConnector?: {
    /** Component name to render */
    component: string;
    /** Title to display */
    title: string;
  };
}

/**
 * Extension manifest (extension metadata)
 */
export interface ExtensionManifest {
  /** Unique extension identifier (must match directory name) */
  id: string;
  /** Human-readable extension name */
  name: string;
  /** Extension version (semver) */
  version: string;
  /** Extension description */
  description: string;
  /** Extension author (optional) */
  author?: string;
  /** Minimum required Dyad version (optional) */
  dyadVersion?: string;
  /** Extension capabilities */
  capabilities: ExtensionCapabilities;
  /** Main process entry point (relative to extension root) */
  main?: string;
  /** Renderer process entry point (relative to extension root, optional) */
  renderer?: string;
  /** UI integration configuration */
  ui?: ExtensionUI;
}

/**
 * Database type helper
 */
export type Database = BetterSQLite3Database<typeof schema>;

/**
 * Extension context provided to main process extensions
 */
export interface ExtensionContext {
  /** Extension identifier */
  extensionId: string;
  /** Extension manifest */
  manifest: ExtensionManifest;
  /** Logger scoped to this extension */
  logger: log.LogFunctions;
  /** Register an IPC handler (automatically namespaced) */
  registerIpcHandler: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any,
  ) => void;
  /** Get database instance */
  getDb: () => Database;
  /** Read user settings */
  readSettings: () => UserSettings;
  /** Write user settings */
  writeSettings: (settings: Partial<UserSettings>) => void;
  /** Get app by ID */
  getApp: (appId: number) => Promise<App>;
  /** Update app data */
  updateApp: (appId: number, data: Partial<App>) => Promise<void>;
  /** Set extension-specific data for an app */
  setExtensionData: (appId: number, key: string, value: any) => Promise<void>;
  /** Get extension-specific data for an app */
  getExtensionData: (appId: number, key: string) => Promise<any>;
  /** Get all extension data for an app */
  getAllExtensionData: (appId: number) => Promise<Record<string, any>>;
}

/**
 * Extension renderer context (for future use)
 */
export interface ExtensionRendererContext {
  extensionId: string;
  manifest: ExtensionManifest;
}

/**
 * Main process extension entry point function
 */
export type ExtensionMain = (context: ExtensionContext) => void | Promise<void>;

/**
 * Renderer process extension entry point function
 */
export type ExtensionRenderer = (
  context: ExtensionRendererContext,
) => void | Promise<void>;

/**
 * Loaded extension metadata
 */
export interface LoadedExtension {
  /** Extension manifest */
  manifest: ExtensionManifest;
  /** Extension directory path */
  directory: string;
  /** Main process entry point (if loaded) */
  mainEntry?: ExtensionMain;
  /** Renderer process entry point (if loaded) */
  rendererEntry?: ExtensionRenderer;
  /** Registered IPC channels */
  registeredChannels: string[];
}
