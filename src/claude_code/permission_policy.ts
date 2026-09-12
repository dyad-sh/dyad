/**
 * Tool restrictions and permission decisions for Claude Code turns.
 *
 * Restrictions are enforced three ways, all of which must agree:
 *
 * 1. `--restricted` plus an explicit `--tools` allowlist and `--disallowedTools`
 *    denylist remove Bash and every other command/code-running tool from the
 *    CLI's tool set (the model cannot even see them).
 * 2. `--setting-sources ""` and `--strict-mcp-config` stop the CLI from
 *    inheriting user/project hooks, plugins, and MCP servers; the only MCP
 *    server is Dyad's in-process bridge.
 * 3. Every remaining tool call still passes through `decideToolPermission`,
 *    which fails closed: anything not explicitly allowed is denied.
 *
 * Disabling Bash is a tool restriction, not an OS sandbox. Dependency
 * installs, tests, and preview restarts exposed through the bridge still run
 * project code.
 */
import path from "node:path";
import type { AgentToolConsent } from "@/lib/schemas";
import type { ChatBackendTurnMode } from "@/chat_backend/backend";

export const CLAUDE_CODE_MCP_SERVER_NAME = "dyad";
export const CLAUDE_CODE_MCP_TOOL_PREFIX = `mcp__${CLAUDE_CODE_MCP_SERVER_NAME}__`;

/** Built-in read/search tools available in every mode. */
export const CLAUDE_CODE_READ_TOOLS = ["Read", "Glob", "Grep"] as const;
/** Built-in editing tools available only in Agent mode. */
export const CLAUDE_CODE_EDIT_TOOLS = ["Edit", "Write"] as const;

/**
 * Explicit denylist passed through `--disallowedTools`. `--restricted` and the
 * `--tools` allowlist already exclude these; the denylist is defense in depth
 * against a CLI release that adds a tool to the allowlisted names.
 */
export const CLAUDE_CODE_DISALLOWED_TOOLS = [
  "Bash",
  "PowerShell",
  "BashOutput",
  "KillShell",
  "REPL",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "Skill",
  "ToolSearch",
  "EnterWorktree",
  "ExitWorktree",
  "Workflow",
  "SendMessage",
  "ListAgents",
  "Monitor",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "RemoteTrigger",
  "PushNotification",
  "TaskOutput",
  "TaskStop",
  "DesignSync",
  "ReportFindings",
  "TodoWrite",
] as const;

export function getBuiltInToolsForMode(mode: ChatBackendTurnMode): string[] {
  return mode === "agent"
    ? [...CLAUDE_CODE_READ_TOOLS, ...CLAUDE_CODE_EDIT_TOOLS]
    : [...CLAUDE_CODE_READ_TOOLS];
}

export interface BuildClaudeCliArgsOptions {
  mode: ChatBackendTurnMode;
  model: string;
  effortLevel?: string | null;
  /** Resume this session id; mutually exclusive with `newSessionId`. */
  resumeSessionId?: string | null;
  /** Mint this session id for a fresh conversation. */
  newSessionId?: string | null;
  /** File containing the text appended to the CLI's default system prompt. */
  appendSystemPromptFile: string;
  /** File containing the `--mcp-config` JSON for the in-process bridge. */
  mcpConfigFile: string;
}

const CLI_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function buildClaudeCodeCliArgs(
  options: BuildClaudeCliArgsOptions,
): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Route every permission prompt to Dyad over stdin/stdout.
    "--permission-prompt-tool",
    "stdio",
    "--permission-mode",
    "default",
    // Do not inherit user/project/local settings (hooks, plugins, MCP).
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    options.mcpConfigFile,
    // Remove command/code execution tools and confine file tools to cwd.
    "--restricted",
    "--tools",
    getBuiltInToolsForMode(options.mode).join(","),
    "--disallowedTools",
    CLAUDE_CODE_DISALLOWED_TOOLS.join(","),
    "--disable-slash-commands",
    "--model",
    options.model,
    "--append-system-prompt-file",
    options.appendSystemPromptFile,
  ];
  if (options.effortLevel && CLI_EFFORT_LEVELS.has(options.effortLevel)) {
    args.push("--effort", options.effortLevel);
  }
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  } else if (options.newSessionId) {
    args.push("--session-id", options.newSessionId);
  }
  return args;
}

export type ToolPermissionDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | {
      kind: "ask";
      consentToolName: string;
      description: string | null;
      inputPreview: string | null;
    };

/** Bridge tool → Dyad consent identity and default consent. */
export interface BridgeToolConsentPolicy {
  consentToolName: string;
  defaultConsent: AgentToolConsent;
  /** True when the tool only inspects state. */
  readOnly: boolean;
  description: string;
  preview: (input: unknown) => string | null;
}

export const BRIDGE_TOOL_CONSENT_POLICIES: Readonly<
  Record<string, BridgeToolConsentPolicy>
> = {
  add_dependency: {
    consentToolName: "add_dependency",
    defaultConsent: "ask",
    readOnly: false,
    description: "Install or refresh npm packages",
    preview: (input) => {
      const packages = (input as { packages?: unknown })?.packages;
      return Array.isArray(packages)
        ? `Install or refresh ${packages.map(String).join(", ")}`
        : null;
    },
  },
  run_type_checks: {
    consentToolName: "run_type_checks",
    defaultConsent: "always",
    readOnly: true,
    description: "Run the app's TypeScript type check",
    preview: () => "Check types",
  },
  run_tests: {
    consentToolName: "run_tests",
    defaultConsent: "always",
    readOnly: false,
    description: "Run one Playwright spec",
    preview: (input) => {
      const testFile = (input as { testFile?: unknown })?.testFile;
      return typeof testFile === "string" ? `Run test: ${testFile}` : null;
    },
  },
  read_logs: {
    consentToolName: "read_logs",
    defaultConsent: "always",
    readOnly: true,
    description: "Read the running app's recent logs",
    preview: () => "Read app logs",
  },
  restart_app: {
    consentToolName: "restart_app",
    defaultConsent: "always",
    readOnly: false,
    description: "Restart the app preview",
    preview: () => "Restart the current app",
  },
};

export function getBridgeToolNamesForMode(mode: ChatBackendTurnMode): string[] {
  return Object.entries(BRIDGE_TOOL_CONSENT_POLICIES)
    .filter(([, policy]) => mode === "agent" || policy.readOnly)
    .map(([name]) => name);
}

const PROTECTED_WRITE_SEGMENTS = new Set([".git", "node_modules", ".dyad"]);

export function isPathInsideApp(appPath: string, candidate: string): boolean {
  const root = path.resolve(appPath);
  const target = path.resolve(root, candidate);
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function relativeSegments(appPath: string, candidate: string): string[] {
  const relative = path.relative(
    path.resolve(appPath),
    path.resolve(appPath, candidate),
  );
  return relative.split(/[\\/]/).filter(Boolean);
}

export function isSecretEnvFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === ".env" || base.startsWith(".env.");
}

function firstPathInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of ["file_path", "path", "notebook_path"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return null;
}

function effectiveConsent(
  consents: Record<string, AgentToolConsent> | undefined,
  toolName: string,
  fallback: AgentToolConsent,
): AgentToolConsent {
  return consents?.[toolName] ?? fallback;
}

export interface DecideToolPermissionParams {
  toolName: string;
  input: unknown;
  mode: ChatBackendTurnMode;
  appPath: string;
  consents: Record<string, AgentToolConsent> | undefined;
}

/**
 * Fail-closed permission decision for one Claude Code tool call.
 *
 * - Read/Glob/Grep: allowed inside the app directory (secret env files are
 *   blocked; Dyad's own read tool redacts them and the CLI would not).
 * - Edit/Write: Agent mode only, inside the app directory, never under
 *   `.git`, `node_modules`, or `.dyad`; honours the user's `write_file`
 *   consent setting.
 * - Dyad bridge tools: available per mode, honouring each tool's Dyad
 *   consent setting (`ask` prompts in chat, `never` denies).
 * - Everything else (Bash, subagents, web, plugins, unknown MCP servers) is
 *   denied even if a CLI release exposes it.
 */
export function decideToolPermission({
  toolName,
  input,
  mode,
  appPath,
  consents,
}: DecideToolPermissionParams): ToolPermissionDecision {
  if ((CLAUDE_CODE_READ_TOOLS as readonly string[]).includes(toolName)) {
    const target = firstPathInput(input);
    if (target !== null) {
      if (!isPathInsideApp(appPath, target)) {
        return {
          kind: "deny",
          reason: `Dyad only allows reading files inside the app directory (${target}).`,
        };
      }
      if (isSecretEnvFile(target)) {
        return {
          kind: "deny",
          reason:
            "Dyad blocks reading environment secret files (.env*) through Claude Code.",
        };
      }
    }
    return { kind: "allow" };
  }

  if ((CLAUDE_CODE_EDIT_TOOLS as readonly string[]).includes(toolName)) {
    if (mode !== "agent") {
      return {
        kind: "deny",
        reason: `${mode === "ask" ? "Ask" : "Plan"} mode is read-only; file edits are not permitted.`,
      };
    }
    const target = firstPathInput(input);
    if (target === null) {
      return { kind: "deny", reason: `${toolName} call had no file path.` };
    }
    if (!isPathInsideApp(appPath, target)) {
      return {
        kind: "deny",
        reason: `Dyad only allows editing files inside the app directory (${target}).`,
      };
    }
    const segments = relativeSegments(appPath, target);
    if (segments.some((segment) => PROTECTED_WRITE_SEGMENTS.has(segment))) {
      return {
        kind: "deny",
        reason: `Dyad does not allow edits under .git, node_modules, or .dyad (${target}).`,
      };
    }
    const consent = effectiveConsent(consents, "write_file", "always");
    if (consent === "never") {
      return {
        kind: "deny",
        reason: "File edits are disabled in Dyad's agent permission settings.",
      };
    }
    if (consent === "ask") {
      return {
        kind: "ask",
        consentToolName: "write_file",
        description: `${toolName} file`,
        inputPreview: target,
      };
    }
    return { kind: "allow" };
  }

  if (toolName.startsWith(CLAUDE_CODE_MCP_TOOL_PREFIX)) {
    const bridgeTool = toolName.slice(CLAUDE_CODE_MCP_TOOL_PREFIX.length);
    const policy = BRIDGE_TOOL_CONSENT_POLICIES[bridgeTool];
    if (!policy) {
      return { kind: "deny", reason: `Unknown Dyad tool ${bridgeTool}.` };
    }
    if (mode !== "agent" && !policy.readOnly) {
      return {
        kind: "deny",
        reason: `${bridgeTool} is not available in ${mode === "ask" ? "Ask" : "Plan"} mode.`,
      };
    }
    const consent = effectiveConsent(
      consents,
      policy.consentToolName,
      policy.defaultConsent,
    );
    if (consent === "never") {
      return {
        kind: "deny",
        reason: `${bridgeTool} is disabled in Dyad's agent permission settings.`,
      };
    }
    if (consent === "ask") {
      return {
        kind: "ask",
        consentToolName: policy.consentToolName,
        description: policy.description,
        inputPreview: policy.preview(input),
      };
    }
    return { kind: "allow" };
  }

  return {
    kind: "deny",
    reason: `Dyad does not permit the ${toolName} tool for Claude Code turns.`,
  };
}
