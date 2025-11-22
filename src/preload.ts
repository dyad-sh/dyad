// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webFrame } from "electron";

// Whitelist of valid channels
const validInvokeChannels = [
  "analyze-component",
  "apply-visual-editing-changes",
  "get-language-models",
  "get-language-models-by-providers",
  "create-custom-language-model",
  "get-language-model-providers",
  "delete-custom-language-model-provider",
  "create-custom-language-model-provider",
  "edit-custom-language-model-provider",
  "delete-custom-language-model",
  "delete-custom-model",
  "chat:add-dep",
  "chat:message",
  "chat:cancel",
  "chat:stream",
  "chat:count-tokens",
  "create-chat",
  "create-app",
  "copy-app",
  "get-chat",
  "get-chats",
  "search-chats",
  "get-chat-logs",
  "list-apps",
  "get-app",
  "search-app-files",
  "get-app-env-vars",
  "set-app-env-vars",
  "edit-app-file",
  "read-app-file",
  "run-app",
  "stop-app",
  "restart-app",
  "respond-to-app-input",
  "search-app",
  "list-versions",
  "revert-version",
  "checkout-version",
  "get-current-branch",
  "delete-app",
  "rename-app",
  "get-user-settings",
  "set-user-settings",
  "get-env-vars",
  "open-external-url",
  "show-item-in-folder",
  "reset-all",
  "nodejs-status",
  "install-node",
  "select-node-folder",
  "github:start-flow",
  "github:list-repos",
  "github:get-repo-branches",
  "github:is-repo-available",
  "github:create-repo",
  "github:connect-existing-repo",
  "github:push",
  "github:fetch",
  "github:rebase",
  "github:rebase-abort",
  "github:merge-abort",
  "github:rebase-continue",
  "github:list-local-branches",
  "github:list-remote-branches",
  "github:create-branch",
  "github:switch-branch",
  "github:list-collaborators",
  "github:invite-collaborator",
  "github:remove-collaborator",
  "github:rename-branch",
  "github:merge-branch",
  "github:get-conflicts",
  "github:delete-branch",
  "github:get-git-state",
  "github:disconnect",
  "git:get-uncommitted-files",
  "git:commit-changes",
  "neon:create-project",
  "neon:get-project",
  "neon:delete-branch",
  "vercel:save-token",
  "vercel:list-projects",
  "vercel:is-project-available",
  "vercel:create-project",
  "vercel:connect-existing-project",
  "vercel:get-deployments",
  "vercel:disconnect",
  "get-app-version",
  "reload-env-path",
  "get-proposal",
  "approve-proposal",
  "reject-proposal",
  "get-system-debug-info",
  "supabase:list-organizations",
  "supabase:delete-organization",
  "supabase:list-all-projects",
  "supabase:list-branches",
  "supabase:get-edge-logs",
  "supabase:set-app-project",
  "supabase:unset-app-project",
  "local-models:list-ollama",
  "local-models:list-lmstudio",
  "window:minimize",
  "window:maximize",
  "window:close",
  "get-system-platform",
  "upload-to-signed-url",
  "delete-chat",
  "update-chat",
  "delete-messages",
  "start-chat-stream",
  "does-release-note-exist",
  "import-app",
  "check-ai-rules",
  "select-app-folder",
  "check-app-name",
  "rename-branch",
  "clear-session-data",
  "select-app-location",
  "change-app-location",
  "get-user-budget",
  "get-context-paths",
  "set-context-paths",
  "get-app-upgrades",
  "execute-app-upgrade",
  "is-capacitor",
  "sync-capacitor",
  "open-ios",
  "open-android",
  "check-problems",
  "restart-dyad",
  "get-templates",
  "portal:migrate-create",
  // MCP
  "mcp:list-servers",
  "mcp:create-server",
  "mcp:update-server",
  "mcp:delete-server",
  "mcp:list-tools",
  "mcp:get-tool-consents",
  "mcp:set-tool-consent",
  // MCP consent response from renderer to main
  "mcp:tool-consent-response",
  // Agent Tools (Local Agent v2)
  "agent-tool:get-tools",
  "agent-tool:set-consent",
  "agent-tool:consent-response",
  // Help
  "take-screenshot",
  // Help bot
  "help:chat:start",
  "help:chat:cancel",
  // Prompts
  "prompts:list",
  "prompts:create",
  "prompts:update",
  "prompts:delete",
  "chat:transcribe",
  // adding app to favorite
  "add-to-favorite",
  "github:clone-repo-from-url",
  "get-latest-security-review",
  // Console logs
  "add-log",
  "clear-logs",
  // Themes
  "get-themes",
  "set-app-theme",
  "get-app-theme",
  "get-custom-themes",
  "create-custom-theme",
  "update-custom-theme",
  "delete-custom-theme",
  "generate-theme-prompt",
  "save-theme-image",
  "cleanup-theme-images",
  // Test-only channels
  // These should ALWAYS be guarded with IS_TEST_BUILD in the main process.
  // We can't detect with IS_TEST_BUILD in the preload script because
  // it's a separate process from the main process.
  "supabase:fake-connect-and-set-project",
];

// Add valid receive channels
const validReceiveChannels = [
  "chat:response:chunk",
  "chat:response:end",
  "chat:response:error",
  "app:output",
  "github:flow-update",
  "github:flow-success",
  "github:flow-error",
  "deep-link-received",
  "force-close-detected",
  // Help bot
  "help:chat:response:chunk",
  "help:chat:response:end",
  "help:chat:response:error",
  // MCP consent request from main to renderer
  "mcp:tool-consent-request",
  // Agent tool consent request from main to renderer
  "agent-tool:consent-request",
  // Agent todos update from main to renderer
  "agent-tool:todos-update",
  // Agent problems update from main to renderer
  "agent-tool:problems-update",
  // Telemetry events from main to renderer
  "telemetry:event",
] as const;

type ValidInvokeChannel = (typeof validInvokeChannels)[number];
type ValidReceiveChannel = (typeof validReceiveChannels)[number];

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    invoke: (channel: ValidInvokeChannel, ...args: unknown[]) => {
      if (validInvokeChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Invalid channel: ${channel}`);
    },
    on: (
      channel: ValidReceiveChannel,
      listener: (...args: unknown[]) => void,
    ) => {
      if (validReceiveChannels.includes(channel)) {
        const subscription = (
          _event: Electron.IpcRendererEvent,
          ...args: unknown[]
        ) => listener(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
      throw new Error(`Invalid channel: ${channel}`);
    },
    removeAllListeners: (channel: ValidReceiveChannel) => {
      if (validReceiveChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    },
    removeListener: (
      channel: ValidReceiveChannel,
      listener: (...args: unknown[]) => void,
    ) => {
      if (validReceiveChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, listener);
      }
    },
  },
  webFrame: {
    setZoomFactor: (factor: number) => {
      webFrame.setZoomFactor(factor);
    },
    getZoomFactor: () => webFrame.getZoomFactor(),
  },
});
