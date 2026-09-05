import { describe, expect, it } from "vitest";
import {
  buildClaudeCodeCliArgs,
  CLAUDE_CODE_DISALLOWED_TOOLS,
  decideToolPermission,
  getBridgeToolNamesForMode,
  getBuiltInToolsForMode,
  isPathInsideApp,
} from "./permission_policy";

const appPath = "/tmp/dyad-app";

describe("permission_policy", () => {
  describe("built-in tool restriction", () => {
    it("never enables Bash or other execution tools", () => {
      for (const mode of ["agent", "ask", "plan"] as const) {
        const tools = getBuiltInToolsForMode(mode);
        expect(tools).not.toContain("Bash");
        expect(tools).not.toContain("Task");
        expect(tools).not.toContain("WebFetch");
      }
      expect(CLAUDE_CODE_DISALLOWED_TOOLS).toContain("Bash");
      expect(CLAUDE_CODE_DISALLOWED_TOOLS).toContain("PowerShell");
    });

    it("gives Agent mode edit tools and keeps Ask/Plan read-only", () => {
      expect(getBuiltInToolsForMode("agent")).toEqual([
        "Read",
        "Glob",
        "Grep",
        "Edit",
        "Write",
      ]);
      expect(getBuiltInToolsForMode("ask")).toEqual(["Read", "Glob", "Grep"]);
      expect(getBuiltInToolsForMode("plan")).toEqual(["Read", "Glob", "Grep"]);
    });

    it("builds a restricted, stdio-permission CLI invocation", () => {
      const args = buildClaudeCodeCliArgs({
        mode: "agent",
        model: "opus",
        effortLevel: "high",
        newSessionId: "11111111-1111-4111-8111-111111111111",
        appendSystemPromptFile: "/tmp/prompt.md",
        mcpConfigFile: "/tmp/mcp.json",
      });
      expect(args).toContain("--restricted");
      expect(args).toContain("--strict-mcp-config");
      expect(
        args.slice(
          args.indexOf("--setting-sources"),
          2 + args.indexOf("--setting-sources"),
        ),
      ).toEqual(["--setting-sources", ""]);
      expect(args[args.indexOf("--permission-prompt-tool") + 1]).toBe("stdio");
      expect(args[args.indexOf("--tools") + 1]).toBe(
        "Read,Glob,Grep,Edit,Write",
      );
      expect(args[args.indexOf("--disallowedTools") + 1]).toContain("Bash");
      expect(args[args.indexOf("--effort") + 1]).toBe("high");
      expect(args[args.indexOf("--session-id") + 1]).toBe(
        "11111111-1111-4111-8111-111111111111",
      );
      expect(args).not.toContain("--resume");
      expect(args).not.toContain("--continue");
      expect(args).not.toContain("--dangerously-skip-permissions");
    });

    it("resumes only the explicit session id", () => {
      const args = buildClaudeCodeCliArgs({
        mode: "ask",
        model: "sonnet",
        resumeSessionId: "22222222-2222-4222-8222-222222222222",
        newSessionId: "33333333-3333-4333-8333-333333333333",
        appendSystemPromptFile: "/tmp/prompt.md",
        mcpConfigFile: "/tmp/mcp.json",
      });
      expect(args[args.indexOf("--resume") + 1]).toBe(
        "22222222-2222-4222-8222-222222222222",
      );
      expect(args).not.toContain("--session-id");
      expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
      // Unknown effort levels are dropped rather than passed through.
      expect(
        buildClaudeCodeCliArgs({
          mode: "ask",
          model: "sonnet",
          effortLevel: "none",
          appendSystemPromptFile: "/tmp/prompt.md",
          mcpConfigFile: "/tmp/mcp.json",
        }),
      ).not.toContain("--effort");
    });
  });

  describe("decideToolPermission", () => {
    const base = { mode: "agent" as const, appPath, consents: undefined };

    it("denies Bash and any unknown tool even if the CLI exposes it", () => {
      expect(
        decideToolPermission({
          ...base,
          toolName: "Bash",
          input: { command: "ls" },
        }),
      ).toMatchObject({ kind: "deny" });
      expect(
        decideToolPermission({ ...base, toolName: "WebFetch", input: {} }),
      ).toMatchObject({ kind: "deny" });
      expect(
        decideToolPermission({
          ...base,
          toolName: "mcp__other__thing",
          input: {},
        }),
      ).toMatchObject({ kind: "deny" });
    });

    it("allows reads inside the app and blocks reads outside or of secrets", () => {
      expect(
        decideToolPermission({
          ...base,
          toolName: "Read",
          input: { file_path: `${appPath}/src/App.tsx` },
        }),
      ).toEqual({ kind: "allow" });
      expect(
        decideToolPermission({
          ...base,
          toolName: "Read",
          input: { file_path: "/etc/passwd" },
        }),
      ).toMatchObject({ kind: "deny" });
      expect(
        decideToolPermission({
          ...base,
          toolName: "Read",
          input: { file_path: `${appPath}/.env.local` },
        }),
      ).toMatchObject({
        kind: "deny",
        reason: expect.stringContaining(".env"),
      });
      expect(
        decideToolPermission({
          ...base,
          toolName: "Grep",
          input: { pattern: "x" },
        }),
      ).toEqual({ kind: "allow" });
    });

    it("rejects edits in Ask and Plan modes", () => {
      for (const mode of ["ask", "plan"] as const) {
        expect(
          decideToolPermission({
            ...base,
            mode,
            toolName: "Write",
            input: { file_path: `${appPath}/src/new.ts`, content: "" },
          }),
        ).toMatchObject({
          kind: "deny",
          reason: expect.stringContaining("read-only"),
        });
        expect(
          decideToolPermission({
            ...base,
            mode,
            toolName: "mcp__dyad__add_dependency",
            input: { packages: ["zod"] },
          }),
        ).toMatchObject({ kind: "deny" });
      }
    });

    it("allows edits inside the app but never under .git, node_modules, or .dyad", () => {
      expect(
        decideToolPermission({
          ...base,
          toolName: "Edit",
          input: {
            file_path: `${appPath}/src/App.tsx`,
            old_string: "a",
            new_string: "b",
          },
        }),
      ).toEqual({ kind: "allow" });
      expect(
        decideToolPermission({
          ...base,
          toolName: "Write",
          input: { file_path: `${appPath}/../other/file.ts`, content: "" },
        }),
      ).toMatchObject({ kind: "deny" });
      for (const protectedPath of [
        ".git/config",
        "node_modules/x/index.js",
        ".dyad/plans/p.md",
      ]) {
        expect(
          decideToolPermission({
            ...base,
            toolName: "Write",
            input: { file_path: `${appPath}/${protectedPath}`, content: "" },
          }),
        ).toMatchObject({ kind: "deny" });
      }
    });

    it("honours the user's write_file consent for file edits", () => {
      expect(
        decideToolPermission({
          ...base,
          consents: { write_file: "never" },
          toolName: "Write",
          input: { file_path: `${appPath}/a.ts`, content: "" },
        }),
      ).toMatchObject({ kind: "deny" });
      expect(
        decideToolPermission({
          ...base,
          consents: { write_file: "ask" },
          toolName: "Write",
          input: { file_path: `${appPath}/a.ts`, content: "" },
        }),
      ).toMatchObject({ kind: "ask", consentToolName: "write_file" });
    });

    it("maps Dyad bridge tools to their consent defaults", () => {
      expect(
        decideToolPermission({
          ...base,
          toolName: "mcp__dyad__add_dependency",
          input: { packages: ["zod"] },
        }),
      ).toMatchObject({
        kind: "ask",
        consentToolName: "add_dependency",
        inputPreview: "Install or refresh zod",
      });
      expect(
        decideToolPermission({
          ...base,
          consents: { add_dependency: "always" },
          toolName: "mcp__dyad__add_dependency",
          input: { packages: ["zod"] },
        }),
      ).toEqual({ kind: "allow" });
      expect(
        decideToolPermission({
          ...base,
          toolName: "mcp__dyad__run_type_checks",
          input: {},
        }),
      ).toEqual({ kind: "allow" });
      expect(
        decideToolPermission({
          ...base,
          mode: "ask",
          toolName: "mcp__dyad__read_logs",
          input: {},
        }),
      ).toEqual({ kind: "allow" });
      expect(
        decideToolPermission({
          ...base,
          toolName: "mcp__dyad__nonexistent",
          input: {},
        }),
      ).toMatchObject({ kind: "deny" });
    });

    it("exposes only read-only bridge tools outside Agent mode", () => {
      expect(getBridgeToolNamesForMode("agent")).toEqual([
        "add_dependency",
        "run_type_checks",
        "run_tests",
        "read_logs",
        "restart_app",
      ]);
      expect(getBridgeToolNamesForMode("ask")).toEqual([
        "run_type_checks",
        "read_logs",
      ]);
      expect(getBridgeToolNamesForMode("plan")).toEqual([
        "run_type_checks",
        "read_logs",
      ]);
    });
  });

  it("treats the app root itself as inside the app", () => {
    expect(isPathInsideApp(appPath, appPath)).toBe(true);
    expect(isPathInsideApp(appPath, "src/index.ts")).toBe(true);
    expect(isPathInsideApp(appPath, "../escape.ts")).toBe(false);
  });
});
