/**
 * run_command tool — Execute shell commands scoped to the app's project directory.
 * Requires user approval for every invocation (consent: "ask").
 */

import { exec } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr, escapeXmlContent } from "./types";

const logger = log.scope("run_command");

const runCommandSchema = z.object({
  command: z.string().describe("The shell command to execute"),
  working_directory: z
    .string()
    .optional()
    .describe(
      "Working directory relative to the app root (default: app root). Must not escape the project.",
    ),
  timeout_ms: z
    .number()
    .optional()
    .describe("Timeout in milliseconds (default: 30000, max: 120000)"),
});

/**
 * Dangerous command patterns that should never be executed.
 * The user approval step is the main safety gate, but this provides defense-in-depth.
 */
const BLOCKED_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\s+[/\\]/i, // rm -rf /
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\breg\s+(delete|add)\b/i, // Windows registry
];

export const runCommandTool: ToolDefinition<z.infer<typeof runCommandSchema>> =
  {
    name: "run_command",
    description: `Execute a shell command in the app's project directory. Use this to:
- Run tests (e.g. "npm test", "npx vitest run")
- Run linters or formatters (e.g. "npx eslint src/", "npx prettier --write src/")
- Run build commands (e.g. "npm run build")
- Check installed packages ("cat package.json")
- Run database migrations
- Any other CLI operation needed for development

The command runs with the app directory as the working directory.
Every command requires explicit user approval before execution.
Output is captured (stdout + stderr) and returned to you. Max output: 10000 chars.`,
    inputSchema: runCommandSchema,
    defaultConsent: "ask",

    getConsentPreview: (args) => {
      const cwd = args.working_directory
        ? ` (in ${args.working_directory})`
        : "";
      return `Run: ${args.command}${cwd}`;
    },

    buildXml: (args, isComplete) => {
      if (!args.command) return undefined;
      const cwdAttr = args.working_directory
        ? ` directory="${escapeXmlAttr(args.working_directory)}"`
        : "";
      let xml = `<joy-run-command${cwdAttr}>\n${escapeXmlContent(args.command)}`;
      if (isComplete) {
        xml += "\n</joy-run-command>";
      }
      return xml;
    },

    execute: async (args, ctx: AgentContext) => {
      const { command, working_directory, timeout_ms } = args;

      // Validate: block obviously dangerous commands
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
          throw new Error(
            `Command blocked for safety: "${command}" matches a restricted pattern.`,
          );
        }
      }

      // Resolve working directory, ensuring it stays within the app path
      let cwd = ctx.appPath;
      if (working_directory) {
        const resolved = path.resolve(ctx.appPath, working_directory);
        const normalizedBase = path.resolve(ctx.appPath);
        if (!resolved.startsWith(normalizedBase)) {
          throw new Error(
            `Working directory "${working_directory}" escapes the project root.`,
          );
        }
        cwd = resolved;
      }

      const timeout = Math.min(timeout_ms ?? 30_000, 120_000);

      logger.info(
        `Executing command in ${cwd}: ${command} (timeout: ${timeout}ms)`,
      );

      return new Promise<string>((resolve) => {
        const child = exec(
          command,
          {
            cwd,
            timeout,
            maxBuffer: 1024 * 1024, // 1MB buffer
            shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
            env: {
              ...process.env,
              // Disable interactive prompts in common tools
              CI: "true",
              FORCE_COLOR: "0",
            },
          },
          (error, stdout, stderr) => {
            let output = "";

            if (stdout) {
              output += `[stdout]\n${stdout.trim()}\n`;
            }
            if (stderr) {
              output += `[stderr]\n${stderr.trim()}\n`;
            }
            if (error && error.killed) {
              output += `\n[timeout] Command timed out after ${timeout}ms`;
            } else if (error) {
              output += `\n[exit code: ${error.code ?? "unknown"}]`;
            } else {
              output += "\n[exit code: 0]";
            }

            // Truncate if too long
            const MAX_OUTPUT = 10_000;
            if (output.length > MAX_OUTPUT) {
              output =
                output.slice(0, MAX_OUTPUT / 2) +
                "\n\n... [output truncated] ...\n\n" +
                output.slice(-MAX_OUTPUT / 2);
            }

            logger.info(
              `Command finished: ${command} (exit: ${error?.code ?? 0})`,
            );
            resolve(output);
          },
        );

        // If abort signal fires, kill the child process
        ctx.event; // keep reference for GC
        if (child.pid) {
          const onAbort = () => {
            try {
              child.kill("SIGTERM");
            } catch {
              // ignore
            }
          };
          // No direct abort signal on AgentContext, but the process will be
          // cleaned up by the timeout or by Electron's process lifecycle.
        }
      });
    },
  };
