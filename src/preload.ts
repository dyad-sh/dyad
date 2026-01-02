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
  "github:disconnect",
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
  // adding app to favorite
  "add-to-favorite",
  "github:clone-repo-from-url",
  "get-latest-security-review",
  // Agent Builder
  "agent:create",
  "agent:get",
  "agent:list",
  "agent:update",
  "agent:delete",
  "agent:duplicate",
  "agent:tool:create",
  "agent:tool:list",
  "agent:tool:update",
  "agent:tool:delete",
  "agent:workflow:create",
  "agent:workflow:list",
  "agent:workflow:update",
  "agent:workflow:delete",
  "agent:deploy",
  "agent:deployment:list",
  "agent:deployment:stop",
  "agent:test:create",
  "agent:test:list",
  "agent:kb:create",
  "agent:kb:list",
  "agent:ui:create",
  "agent:ui:list",
  "agent:export:json",
  "agent:export:standalone",
  "agent:export:docker",
  // n8n Integration
  "n8n:start",
  "n8n:stop",
  "n8n:status",
  "n8n:db:configure",
  "n8n:db:get-config",
  "n8n:workflow:create",
  "n8n:workflow:update",
  "n8n:workflow:get",
  "n8n:workflow:list",
  "n8n:workflow:delete",
  "n8n:workflow:activate",
  "n8n:workflow:deactivate",
  "n8n:workflow:execute",
  "n8n:workflow:generate",
  "n8n:meta-builder:create",
  "n8n:agent:send-message",
  "n8n:agent:get-messages",
  "n8n:agent:create-collaboration",
  "n8n:agent:get-collaboration",
  "n8n:agent:list-collaborations",
  "n8n:agent:create-collab-workflow",
  // Trustless Local Inference
  "trustless:initialize",
  "trustless:shutdown",
  "trustless:check-providers",
  "trustless:list-models",
  "trustless:get-model-info",
  "trustless:run-inference",
  "trustless:start-stream",
  "trustless:verify-record",
  "trustless:get-record",
  "trustless:list-records",
  "trustless:export-proof",
  "trustless:import-proof",
  "trustless:pin-record",
  "trustless:unpin-record",
  "trustless:create-batch-proof",
  "trustless:verify-batch-proof",
  "trustless:helia-status",
  "trustless:get-stats",
  // LibreOffice Integration
  "libreoffice:status",
  "libreoffice:create",
  "libreoffice:list",
  "libreoffice:get",
  "libreoffice:delete",
  "libreoffice:export",
  "libreoffice:open",
  "libreoffice:get-directory",
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
