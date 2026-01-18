/**
 * Central IPC Registry - Type-safe channel definitions
 *
 * This file serves as the single source of truth for all IPC channels,
 * providing compile-time type safety for both handlers and client calls.
 */

import { z } from "zod";
import type {
  CreateAppParams,
  CreateAppResult,
  App,
  Chat,
  UpdateChatParams,
  ListAppsResponse,
  AppFileSearchResult,
  BranchResult,
  GetAppEnvVarsParams,
  SetAppEnvVarsParams,
  EnvVar,
} from "./ipc_types";
import type { ChatSummary, UserSettings } from "../lib/schemas";

/**
 * Define all IPC channels with their request and response types
 *
 * Pattern:
 * - For channels with no params: use `void` or `undefined`
 * - For channels with single primitive param: use the primitive type directly
 * - For channels with multiple params or object param: use the type/interface
 * - For channels with no return: use `void`
 */
export interface IpcChannelRegistry {
  // App Management
  "create-app": {
    params: CreateAppParams;
    returns: CreateAppResult;
  };
  "get-app": {
    params: number; // appId
    returns: App;
  };
  "list-apps": {
    params: void;
    returns: ListAppsResponse;
  };
  "delete-app": {
    params: { appId: number };
    returns: void;
  };
  "add-to-favorite": {
    params: { appId: number };
    returns: { isFavorite: boolean };
  };
  "search-app-files": {
    params: { appId: number; query: string };
    returns: AppFileSearchResult[];
  };

  // Chat Management
  "create-chat": {
    params: number; // appId
    returns: number; // chatId
  };
  "get-chat": {
    params: number; // chatId
    returns: Chat;
  };
  "get-chats": {
    params: number | undefined; // appId (optional)
    returns: ChatSummary[];
  };
  "update-chat": {
    params: UpdateChatParams;
    returns: void;
  };
  "delete-chat": {
    params: number; // chatId
    returns: void;
  };
  "delete-messages": {
    params: number; // chatId
    returns: void;
  };

  // Settings
  "get-user-settings": {
    params: void;
    returns: UserSettings;
  };
  "set-user-settings": {
    params: Partial<UserSettings>;
    returns: UserSettings;
  };

  // Environment Variables
  "get-app-env-vars": {
    params: GetAppEnvVarsParams;
    returns: EnvVar[];
  };
  "set-app-env-vars": {
    params: SetAppEnvVarsParams;
    returns: void;
  };

  // Version Control
  "get-current-branch": {
    params: { appId: number };
    returns: BranchResult;
  };

  // System
  "restart-dyad": {
    params: void;
    returns: void;
  };
  "get-app-version": {
    params: void;
    returns: { version: string };
  };
  "get-system-platform": {
    params: void;
    returns: string;
  };

  // File Operations
  "read-app-file": {
    params: { appId: number; filePath: string };
    returns: string;
  };
}

/**
 * Helper types to extract params and returns from the registry
 */
export type IpcChannelName = keyof IpcChannelRegistry;

export type IpcParams<T extends IpcChannelName> = IpcChannelRegistry[T]["params"];

export type IpcReturns<T extends IpcChannelName> = IpcChannelRegistry[T]["returns"];

/**
 * Type guard to check if a channel exists in the registry
 */
export function isRegisteredChannel(channel: string): channel is IpcChannelName {
  return channel in channelMetadata;
}

/**
 * Channel metadata for runtime validation and documentation
 * This is optional but provides additional safety and introspection
 */
export const channelMetadata = {
  "create-app": {
    description: "Create a new app",
    group: "app",
  },
  "get-app": {
    description: "Get app details by ID",
    group: "app",
  },
  "list-apps": {
    description: "List all apps",
    group: "app",
  },
  "delete-app": {
    description: "Delete an app",
    group: "app",
  },
  "add-to-favorite": {
    description: "Toggle app favorite status",
    group: "app",
  },
  "search-app-files": {
    description: "Search files within an app",
    group: "app",
  },
  "create-chat": {
    description: "Create a new chat for an app",
    group: "chat",
  },
  "get-chat": {
    description: "Get chat details by ID",
    group: "chat",
  },
  "get-chats": {
    description: "List chats for an app",
    group: "chat",
  },
  "update-chat": {
    description: "Update chat properties",
    group: "chat",
  },
  "delete-chat": {
    description: "Delete a chat",
    group: "chat",
  },
  "delete-messages": {
    description: "Delete all messages in a chat",
    group: "chat",
  },
  "get-user-settings": {
    description: "Get user settings",
    group: "settings",
  },
  "set-user-settings": {
    description: "Update user settings",
    group: "settings",
  },
  "get-app-env-vars": {
    description: "Get app environment variables",
    group: "env",
  },
  "set-app-env-vars": {
    description: "Set app environment variables",
    group: "env",
  },
  "get-current-branch": {
    description: "Get current git branch",
    group: "version-control",
  },
  "restart-dyad": {
    description: "Restart the application",
    group: "system",
  },
  "get-app-version": {
    description: "Get application version",
    group: "system",
  },
  "get-system-platform": {
    description: "Get system platform",
    group: "system",
  },
  "read-app-file": {
    description: "Read a file from an app directory",
    group: "file",
  },
} as const satisfies Record<IpcChannelName, { description: string; group: string }>;
