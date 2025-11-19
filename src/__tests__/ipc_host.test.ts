import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIpcHandlers } from "../ipc/ipc_host";

// Mock all handler modules
vi.mock("../ipc/handlers/app_handlers", () => ({
  registerAppHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/chat_handlers", () => ({
  registerChatHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/chat_stream_handlers", () => ({
  registerChatStreamHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/settings_handlers", () => ({
  registerSettingsHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/shell_handler", () => ({
  registerShellHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/dependency_handlers", () => ({
  registerDependencyHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/github_handlers", () => ({
  registerGithubHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/vercel_handlers", () => ({
  registerVercelHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/node_handlers", () => ({
  registerNodeHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/proposal_handlers", () => ({
  registerProposalHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/debug_handlers", () => ({
  registerDebugHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/supabase_handlers", () => ({
  registerSupabaseHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/neon_handlers", () => ({
  registerNeonHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/local_model_handlers", () => ({
  registerLocalModelHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/token_count_handlers", () => ({
  registerTokenCountHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/window_handlers", () => ({
  registerWindowHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/upload_handlers", () => ({
  registerUploadHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/version_handlers", () => ({
  registerVersionHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/language_model_handlers", () => ({
  registerLanguageModelHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/release_note_handlers", () => ({
  registerReleaseNoteHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/import_handlers", () => ({
  registerImportHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/session_handlers", () => ({
  registerSessionHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/pro_handlers", () => ({
  registerProHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/context_paths_handlers", () => ({
  registerContextPathsHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/app_upgrade_handlers", () => ({
  registerAppUpgradeHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/capacitor_handlers", () => ({
  registerCapacitorHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/problems_handlers", () => ({
  registerProblemsHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/app_env_vars_handlers", () => ({
  registerAppEnvVarsHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/template_handlers", () => ({
  registerTemplateHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/portal_handlers", () => ({
  registerPortalHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/prompt_handlers", () => ({
  registerPromptHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/help_bot_handlers", () => ({
  registerHelpBotHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/mcp_handlers", () => ({
  registerMcpHandlers: vi.fn(),
}));
vi.mock("../ipc/handlers/security_handlers", () => ({
  registerSecurityHandlers: vi.fn(),
}));

describe("IPC Host", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register all IPC handlers", async () => {
    const {
      registerAppHandlers,
    } = await import("../ipc/handlers/app_handlers");
    const {
      registerChatHandlers,
    } = await import("../ipc/handlers/chat_handlers");
    const {
      registerSettingsHandlers,
    } = await import("../ipc/handlers/settings_handlers");

    registerIpcHandlers();

    expect(registerAppHandlers).toHaveBeenCalledTimes(1);
    expect(registerChatHandlers).toHaveBeenCalledTimes(1);
    expect(registerSettingsHandlers).toHaveBeenCalledTimes(1);
    // Add more assertions for other handlers as needed
  });

  it("should handle errors in handler registration", async () => {
    const {
      registerAppHandlers,
    } = await import("../ipc/handlers/app_handlers");
    (registerAppHandlers as any).mockImplementation(() => {
      throw new Error("Handler registration failed");
    });

    expect(() => registerIpcHandlers()).toThrow("Handler registration failed");
  });
});
