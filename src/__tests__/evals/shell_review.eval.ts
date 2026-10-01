/**
 * Live, classification-only shell policy evaluation. Never executes case commands.
 * DYAD_PRO_API_KEY=... npm run eval -- shell_review
 * Uses the production runner (including its eight-second deadline) and inspection tool.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getEvalModel, hasDyadProKey } from "./helpers/get_eval_model";
import cases from "@/prompts/shell_review_policy.cases.json";
import { buildShellReviewPrompt } from "@/prompts/shell_review_policy";
import { shellExecutionGuidance } from "@/shared/shell_capability";
import { reviewToolAction } from "@/pro/main/ipc/handlers/local_agent/tool_safety_reviewer";
import { buildShellInspectionTool } from "@/pro/main/ipc/handlers/local_agent/shell_review";

vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: async () => ({
    modelClient: { model: getEvalModel("openai", "gpt-6-luna") },
  }),
}));
vi.mock("@/main/settings", () => ({ readSettings: () => ({}) }));
vi.mock("@/pro/main/ipc/handlers/local_agent/mcp_consent_context", () => ({
  getRecentTurnsForConsent: vi.fn(),
}));
const descriptions: Record<string, string> = {
  grep: "Search text in local app files.",
  list_files: "List local app files.",
  git_status: "Inspect the app repository Git working tree and index status.",
  read_logs: "Read local Dyad app preview logs; cannot read cloud logs.",
  cloud_logs:
    "Read Google Cloud logs for a specified project, filter, and result limit.",
};
const resultsPath =
  process.env.SHELL_REVIEW_EVAL_RESULTS ??
  ".claude/tmp/shell-review-eval.jsonl";
describe.skipIf(!hasDyadProKey())("gpt-6-luna shell policy (live)", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "dyad-shell-policy-eval-"));
    await mkdir(path.dirname(resultsPath), { recursive: true });
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it.each(cases.map((entry, i) => ({ ...entry, id: i + 1 })))(
    "$id: $reason",
    async (entry) => {
      const appPath = path.join(root, String(entry.id));
      await mkdir(path.join(appPath, "scripts"), { recursive: true });
      await mkdir(path.join(appPath, "public"), { recursive: true });
      if (entry.scriptEvidence && entry.scriptEvidence !== "Unavailable") {
        await writeFile(
          path.join(appPath, "scripts/transform.js"),
          'import sharp from "sharp"; await sharp("assets/input.png").webp().toFile("assets/output.webp");',
        );
      }
      if (entry.payloadEvidence)
        await writeFile(
          path.join(appPath, "public/catalog.json"),
          '[{"name":"Public sample product","price":10}]',
        );
      const tools = [
        ...(entry.tools ?? []),
        ...(entry.disabledTools ?? []),
      ].map((name) => ({
        name,
        description: descriptions[name] ?? name,
        available: !entry.disabledTools?.includes(name),
      }));
      const inspections: unknown[] = [];
      const started = Date.now();
      const verdict = await reviewToolAction({
        settings: {} as Parameters<typeof reviewToolAction>[0]["settings"],
        system: buildShellReviewPrompt(),
        fallback: "block",
        prepare: async (signal) => {
          const inspection = buildShellInspectionTool(appPath, signal);
          const execute = inspection.execute!;
          inspection.execute = async (args, options) => {
            try {
              if (entry.scriptEvidence === "Unavailable")
                throw new Error(
                  "Inspection unavailable; existence and contents cannot be established.",
                );
              const result = await execute(args, options);
              if (Symbol.asyncIterator in result)
                throw new Error(
                  "Inspection unexpectedly returned streaming output",
                );
              inspections.push({ path: args.path, read: args.read, ok: true });
              return result;
            } catch (error) {
              inspections.push({
                path: args.path,
                read: args.read,
                error: error instanceof Error ? error.message : String(error),
              });
              throw error;
            }
          };
          return {
            payload: JSON.stringify({
              command: entry.command,
              description: "Perform the requested app task",
              execution: shellExecutionGuidance(
                entry.shell === "powershell" ? "win32" : "linux",
                appPath,
              ),
              recentTurns: [{ role: "user", content: entry.user }],
              tools,
              history: entry.executionFailure
                ? [
                    {
                      tool: entry.tools?.[0],
                      args: "{}",
                      outcome: `Execution failed (untrusted error details): ${entry.executionFailure}`,
                    },
                  ]
                : [],
            }),
            tools: { inspect_app_path: inspection },
          };
        },
      });
      await appendFile(
        resultsPath,
        JSON.stringify({
          id: entry.id,
          model: "gpt-6-luna",
          command: entry.command,
          expected: entry.expected,
          ...verdict,
          elapsedMs: Date.now() - started,
          inspections,
        }) + "\n",
      );
      expect(verdict.unavailable, verdict.reason).not.toBe(true);
      expect(verdict.decision, verdict.reason).toBe(entry.expected);
    },
  );
});
