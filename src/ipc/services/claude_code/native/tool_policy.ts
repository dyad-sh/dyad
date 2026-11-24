/**
 * Single source of truth for what a native Claude Code turn may use.
 *
 * Every Dyad tool is classified (exhaustiveness is enforced by a test against
 * TOOL_DEFINITIONS), and the CLI receives an explicit native allowlist rather
 * than its default set, so a CLI upgrade cannot add built-ins Dyad does not
 * know about. Names an installed CLI version lacks are ignored by the CLI.
 */

/** Built-in tools a native turn may use. Includes names that differ across
 * CLI versions (Task/Agent, PowerShell on Windows, older background-shell
 * tools); the CLI silently drops names it does not have.
 *
 * Deliberately excluded: worktree tools (would move Claude out of the app
 * folder), plan-mode tools (planning stays in Dyad's Plan mode),
 * AskUserQuestion (Dyad's questionnaire tool is offered instead), TodoWrite
 * (Dyad's todo panel tool is offered instead), cron/remote/notification and
 * agent-team tools (they outlive the turn or act outside the app). */
export const NATIVE_TOOL_ALLOWLIST = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "LS",
  "Bash",
  "BashOutput",
  "KillShell",
  "PowerShell",
  "Task",
  "Agent",
  "TaskOutput",
  "TaskStop",
  "WebSearch",
  "WebFetch",
  "Skill",
  "ToolSearch",
] as const;

export type NativeToolName = (typeof NATIVE_TOOL_ALLOWLIST)[number];

const ALLOWED = new Set<string>(NATIVE_TOOL_ALLOWLIST);

/** File tools whose `file_path` input identifies the file they change. */
export const NATIVE_FILE_EDIT_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);

/** Tools that run arbitrary commands and may change any file. */
export const NATIVE_SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

/** Subagent tools whose nested events carry `parent_tool_use_id`. */
export const NATIVE_SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

/**
 * How each Dyad tool behaves in a native turn:
 * - `native`: Claude Code's own tools replace it; it is not offered.
 * - `mcp`: still offered through Dyad's MCP server (Claude Code lacks it).
 */
export const DYAD_TOOL_NATIVE_POLICY = {
  // File operations and search → Read/Write/Edit/Glob/Grep/Bash.
  write_file: "native",
  search_replace: "native",
  copy_file: "native",
  delete_file: "native",
  rename_file: "native",
  read_file: "native",
  list_files: "native",
  grep: "native",
  code_search: "native",
  // Git inspection → Bash git. Dyad still commits at the end of the turn.
  git_status: "native",
  git_diff: "native",
  git_log: "native",
  git_show_commit: "native",
  git_show_file: "native",
  git_restore_file: "native",
  // Shell and type checks → Bash.
  run_shell: "native",
  run_type_checks: "native",
  // Child agents → Claude Code's own subagents (Task).
  explore_code: "native",
  spawn_agent: "native",
  list_agents: "native",
  wait_agents: "native",
  cancel_agent: "native",
  send_message: "native",
  followup_task: "native",
  // Third-party MCP access → Dyad's MCP servers are passed to the CLI.
  execute_sandbox_script: "native",
  search_mcp_tools: "native",
  get_mcp_tool_schema: "native",
  // Web search → WebSearch.
  web_search: "native",
  // Everything below is Dyad-specific and stays on Dyad's MCP server.
  web_fetch: "mcp",
  web_crawl: "mcp",
  update_todos: "mcp",
  add_dependency: "mcp",
  execute_sql: "mcp",
  explore_chat_history: "mcp",
  search_chats: "mcp",
  read_chat: "mcp",
  get_supabase_project_info: "mcp",
  get_neon_project_info: "mcp",
  get_database_table_schema: "mcp",
  set_chat_summary: "mcp",
  add_integration: "mcp",
  enable_nitro: "mcp",
  read_logs: "mcp",
  generate_image: "mcp",
  run_pre_commit: "mcp",
  run_build: "mcp",
  run_tests: "mcp",
  generate_test_assertions: "mcp",
  restart_app: "mcp",
  reinstall_and_restart_app: "mcp",
  read_guide: "mcp",
  suggest_plugin: "mcp",
  planning_questionnaire: "mcp",
  write_plan: "mcp",
  exit_plan: "mcp",
  write_app_blueprint: "mcp",
} as const satisfies Record<string, "native" | "mcp">;

export type DyadToolNativePolicy = keyof typeof DYAD_TOOL_NATIVE_POLICY;

/** Dyad MCP tools whose effects depend on the current files, so pending
 * file side effects (e.g. Supabase function deploys) must be scheduled before
 * they run. */
export const WORKSPACE_DEPENDENT_DYAD_TOOLS = new Set([
  "execute_sql",
  "run_build",
  "run_tests",
  "run_pre_commit",
  "restart_app",
  "reinstall_and_restart_app",
  "add_dependency",
  "add_integration",
  "enable_nitro",
]);

/**
 * Whether a Dyad tool (or a third-party MCP tool registered alongside them)
 * stays on Dyad's MCP server in a native turn. Unknown names are Dyad-proxied
 * third-party MCP tools (OAuth servers Dyad must keep authenticating), so
 * they stay on the bridge.
 */
export function keepsDyadMcpTool(name: string): boolean {
  const policy = (DYAD_TOOL_NATIVE_POLICY as Record<string, string>)[name];
  return policy === undefined || policy === "mcp";
}

/** Built-ins every native turn needs. A shell tool must also be present. */
const REQUIRED_NATIVE_TOOLS = ["Read", "Write", "Edit"];

/**
 * Validate the CLI's reported inventory for a native turn. The user's own MCP
 * servers and plugins add `mcp__*` tools, which are expected; any other
 * built-in outside the allowlist means the CLI ignored `--tools`.
 */
export function validateNativeInventory(
  tools: unknown,
  mcpServers: unknown,
  dyadToolNames: readonly string[],
): string | undefined {
  if (!Array.isArray(tools) || tools.some((t) => typeof t !== "string"))
    return "Claude Code reported an invalid tool inventory";
  const names = tools as string[];
  const unexpected = names.filter(
    (name) => !name.startsWith("mcp__") && !ALLOWED.has(name),
  );
  if (unexpected.length)
    return `Claude Code offered tools Dyad did not allow: ${unexpected.join(", ")}`;
  const missing = REQUIRED_NATIVE_TOOLS.filter((name) => !names.includes(name));
  if (!names.some((name) => NATIVE_SHELL_TOOLS.has(name))) missing.push("Bash");
  if (missing.length)
    return `Claude Code is missing required tools: ${missing.join(", ")}`;
  const missingDyad = dyadToolNames.filter((name) => !names.includes(name));
  if (missingDyad.length)
    return `Claude Code did not load Dyad's tools: ${missingDyad.join(", ")}`;
  const dyad = Array.isArray(mcpServers)
    ? mcpServers.find(
        (server) =>
          server && typeof server === "object" && server.name === "dyad",
      )
    : undefined;
  if (!dyad || dyad.status !== "connected")
    return "Claude Code could not connect to Dyad's tool server";
  return undefined;
}
