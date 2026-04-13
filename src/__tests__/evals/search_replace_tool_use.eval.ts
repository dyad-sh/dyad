import { describe, it, expect } from "vitest";
import { generateText, stepCountIs } from "ai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { searchReplaceTool } from "@/pro/main/ipc/handlers/local_agent/tools/search_replace";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { escapeSearchReplaceMarkers } from "@/pro/shared/search_replace_markers";
import {
  SONNET_4_6,
  GEMINI_3_FLASH,
  GPT_5_4,
} from "@/ipc/shared/language_model_constants";
import {
  getEvalModel,
  hasDyadProKey,
  type EvalProvider,
} from "./helpers/get_eval_model";
import {
  normalizeUsage,
  recordEvalRun,
  type LLMRequestRecord,
  type ToolCallRecord,
  type JudgeRecord,
} from "./helpers/eval_recorder";
import { createUnifiedDiff } from "./helpers/unified_diff";

const SUITE_NAME = "search_replace_eval";

// ── Fixture loader ─────────────────────────────────────────────

const FIXTURES_DIR = resolve(__dirname, "fixtures/search_replace");

function loadFixture(filename: string): string {
  return readFileSync(resolve(FIXTURES_DIR, filename), "utf-8");
}

// ── Case type ──────────────────────────────────────────────────

interface EvalCase {
  name: string;
  fileName: string;
  fileContent: string;
  prompt: string;
  // Optional cheap post-edit sanity checks. The authoritative verdict
  // comes from the LLM judge; these guard against the model hallucinating
  // a passing diff that obviously doesn't contain the expected symbols.
  structuralChecks?: string[];
}

// ── Cases ──────────────────────────────────────────────────────

const CASES: EvalCase[] = [
  {
    name: "Extract a helper function",
    fileName: "order_processor.ts",
    fileContent: loadFixture("order_processor.ts"),
    prompt:
      "Extract the validation logic in `processOrder` (the block that checks inventory, " +
      "validates payment, and verifies shipping) into a separate `validateOrder` function. " +
      "The new function should accept the same `order` parameter and return the same " +
      "`ProcessResult` type on validation failure, or `null` if validation passes. " +
      "`processOrder` should call `validateOrder` and return early if it returns a non-null result.",
    structuralChecks: ["function validateOrder", "validateOrder("],
  },
  {
    name: "Add error handling to multiple call sites",
    fileName: "fetch_client.ts",
    fileContent: loadFixture("fetch_client.ts"),
    prompt:
      "Wrap each call to `serviceRequest` in the convenience functions (`getResource`, " +
      "`postResource`, `putResource`, `patchResource`, `deleteResource`) with a try/catch " +
      "that logs `logger.error(`${method} ${path} failed`, err)` (where method and path " +
      "come from the function context) and re-throws the error. Do not modify `serviceRequest` itself.",
    structuralChecks: ["try {", "catch"],
  },
  {
    name: "Convert class component to function component",
    fileName: "UserProfile.tsx",
    fileContent: loadFixture("UserProfile.tsx"),
    prompt:
      "Convert `UserProfile` from a class component to a function component using React hooks. " +
      "Replace `this.state` with `useState` hooks, `componentDidMount`/`componentDidUpdate` " +
      "with `useEffect`, and class methods with regular functions or `useCallback`. " +
      "Keep the same external behavior and JSX structure.",
    structuralChecks: ["function UserProfile", "useState", "useEffect"],
  },
  {
    name: "Refactor giant component into 3 smaller ones",
    fileName: "UserProfileFull.tsx",
    fileContent: loadFixture("UserProfileFull.tsx"),
    prompt:
      "Extract `AvatarSection` (the avatar/upload logic and its JSX around the avatar-section), " +
      "`StatsPanel` (the stats grid, header, and summary around the stats-panel section), " +
      "and `ActivityFeed` (the activity list, grouping, and load-more around the activity-feed section) " +
      "into their own function components in the same file. Pass the necessary props to each. " +
      "Then use `<AvatarSection>`, `<StatsPanel>`, and `<ActivityFeed>` in the main `UserProfile` component.",
    structuralChecks: [
      "function AvatarSection",
      "function StatsPanel",
      "function ActivityFeed",
      "<AvatarSection",
      "<StatsPanel",
      "<ActivityFeed",
    ],
  },
  {
    name: "Reorganize switch into strategy map",
    fileName: "event_handler.ts",
    fileContent: loadFixture("event_handler.ts"),
    prompt:
      "Refactor the `handleEvent` function's switch statement into a " +
      "`Record<EventType, (payload: Record<string, unknown>) => Promise<void>>` handler map " +
      "and a dispatch function. The `handleEvent` function should look up the handler in the map " +
      "and call it, falling back to a warning log for unknown types. Remove the switch statement entirely.",
    structuralChecks: ["Record<", "handleEvent"],
  },
  {
    name: "Convert Promise chains to async/await",
    fileName: "user_service.ts",
    fileContent: loadFixture("user_service.ts"),
    prompt:
      "Rewrite every exported function in this file to use `async`/`await` with a " +
      "`try`/`catch` block instead of `.then()`/`.catch()` chains. Preserve the existing " +
      "error-logging behavior (each catch block should still log and re-throw). Do not " +
      "change any function signatures or return types. Do not add or remove log calls.",
    structuralChecks: ["async function", "await", "try {", "catch"],
  },
  {
    name: "Replace console.* calls with logger.*",
    fileName: "analytics.ts",
    fileContent: loadFixture("analytics.ts"),
    prompt:
      "Replace every real call to `console.log`, `console.warn`, and `console.error` " +
      "with `logger.info`, `logger.warn`, and `logger.error` respectively. Add a new " +
      'import at the top of the file: `import { logger } from "./logger";`. Do NOT ' +
      "modify the word `console` when it appears inside comments or inside string " +
      "literals (for example the help text shown to the user).",
    structuralChecks: [
      "logger.info",
      "logger.warn",
      "logger.error",
      "./logger",
    ],
  },
  {
    name: "Add optional chaining and defaults for nested config access",
    fileName: "config_reader.ts",
    fileContent: loadFixture("config_reader.ts"),
    prompt:
      "Make every nested property access on the `cfg` argument safe against missing " +
      "intermediate objects by using optional chaining (`?.`). For accesses that " +
      "produce the function's return value, use the `??` nullish-coalescing operator to " +
      "supply sensible defaults: empty string for string results, 0 for number results, " +
      "and `false` for boolean results. Do not change any function signatures or the " +
      "`AppConfig` interface.",
    structuralChecks: ["?.", "??"],
  },
  {
    name: "Extract magic numbers into named constants",
    fileName: "cache_manager.ts",
    fileContent: loadFixture("cache_manager.ts"),
    prompt:
      "Extract the duration and size magic numbers in this file into named `const` " +
      "declarations at the top of the module (below any imports and interfaces). " +
      "Use descriptive SCREAMING_SNAKE_CASE names that convey units (e.g. " +
      "`MAX_ENTRY_BYTES`, `MAX_TOTAL_BYTES`, `DEFAULT_TTL_MS`, `CLEANUP_INTERVAL_MS`). " +
      "Replace each occurrence with the new constant. Do not extract ordinary " +
      "integers that are not magic (for example loop counters or `0` initializers).",
    structuralChecks: ["const ", "= "],
  },
  {
    name: "Add zod validation to API handler",
    fileName: "user_handler.ts",
    fileContent: loadFixture("user_handler.ts"),
    prompt:
      'Add an `import { z } from "zod";` statement to this file and define a ' +
      "`createUserBodySchema` that validates the shape of `req.body`: `email` is a " +
      "string email, `name` is a non-empty string, `age` is a non-negative integer, " +
      'and `role` is one of `"admin"`, `"member"`, `"guest"`. At the top of ' +
      "`createUserHandler`, parse `req.body` with the schema inside a try/catch. On a " +
      '`ZodError`, respond with status 400 and a JSON body of `{ error: "invalid ' +
      'body", details: err.issues }`. Read the validated fields from the parsed ' +
      "object instead of from `req.body` directly. Do not change the rest of the " +
      "handler's logic.",
    structuralChecks: [
      'from "zod"',
      "createUserBodySchema",
      ".parse(",
      "ZodError",
    ],
  },
  {
    name: "Dedupe redundant guard/logging block across handlers",
    fileName: "route_handlers.ts",
    fileContent: loadFixture("route_handlers.ts"),
    prompt:
      "All the handlers in this file repeat the same `userId` + `id` validation " +
      "block and the same `logger.info` timing log. Extract the validation into a " +
      "helper `requireAuthedIdParam(req, res)` that returns the validated `id` string " +
      "on success or `null` after writing the 401/400 response. Extract the timing " +
      "log into a helper `logHandlerTiming(name, id, startMs)`. Replace the redundant " +
      "logic in all handlers with these two helpers. Do not change the handlers' " +
      "exported signatures or their response bodies for the success path.",
    structuralChecks: [
      "function requireAuthedIdParam",
      "function logHandlerTiming",
      "requireAuthedIdParam(",
      "logHandlerTiming(",
    ],
  },
  {
    name: "Rename exported function but preserve references in string literals",
    fileName: "order_math.ts",
    fileContent: loadFixture("order_math.ts"),
    prompt:
      "Rename the exported function `calculateTotal` to `computeOrderTotal`. Update " +
      "every call site inside this file to use the new name. Do NOT modify any " +
      "occurrences of the old name `calculateTotal` that appear inside string " +
      "literals (for example inside `throw new Error(...)` messages) — those " +
      "diagnostic strings must keep referring to the historical name.",
    structuralChecks: [
      "function computeOrderTotal",
      "computeOrderTotal(",
      "calculateTotal failed",
    ],
  },
];

// ── Judge helper ───────────────────────────────────────────────

const JUDGE_LABEL = "GPT 5.4";
const JUDGE_PROVIDER: EvalProvider = "openai";
const JUDGE_MODEL = GPT_5_4;

async function judgeResult(
  originalFile: string,
  prompt: string,
  resultFile: string,
): Promise<JudgeRecord> {
  const startMs = Date.now();
  const result = await generateText({
    model: getEvalModel(JUDGE_PROVIDER, JUDGE_MODEL),
    temperature: 1,
    system:
      "You are a code-review judge. You will be given an original file, " +
      "an edit instruction, and the resulting file after the edit was applied. " +
      "Evaluate whether the result correctly implements the requested change " +
      "without introducing bugs, removing unrelated code, or breaking the " +
      "file's existing behavior.\n\n" +
      "Format your response as follows (do NOT keep reasoning private — write " +
      "it in your visible output):\n\n" +
      "1. Write a concise written explanation of what you observed and why you " +
      "are passing or failing the edit. This explanation MUST appear in your " +
      "visible output, not in any hidden reasoning channel.\n" +
      "2. On the VERY LAST line, write exactly `PASS` or `FAIL` and nothing else.",
    messages: [
      {
        role: "user",
        content:
          `## Edit instruction\n${prompt}\n\n` +
          `## Original file\n\`\`\`\n${originalFile}\n\`\`\`\n\n` +
          `## Result file\n\`\`\`\n${resultFile}\n\`\`\``,
      },
    ],
  });
  const durationMs = Date.now() - startMs;

  const text = result.text.trim();
  const lines = text.split("\n");
  const lastLine = lines.at(-1)?.trim() ?? "";
  const pass = lastLine === "PASS";
  // Strip the trailing verdict line so the explanation field holds only
  // the reasoning. If the model emitted only a verdict (no explanation),
  // record a clear marker instead of an empty string so reviewers can
  // tell "no explanation given" apart from "explanation missing due to
  // a bug in the recorder".
  const explanationBody = lines.slice(0, -1).join("\n").trim();
  const explanation =
    explanationBody.length > 0
      ? explanationBody
      : `(no explanation emitted — raw model output was: ${JSON.stringify(text)})`;

  return {
    label: JUDGE_LABEL,
    provider: JUDGE_PROVIDER,
    modelName: JUDGE_MODEL,
    durationMs,
    usage: normalizeUsage(result.totalUsage),
    pass,
    explanation,
  };
}

// ── Shared apply helper ────────────────────────────────────────

function applyEdit(
  fileContent: string,
  args: { old_string: string; new_string: string },
): string {
  const escapedOld = escapeSearchReplaceMarkers(args.old_string);
  const escapedNew = escapeSearchReplaceMarkers(args.new_string);
  const ops = `<<<<<<< SEARCH\n${escapedOld}\n=======\n${escapedNew}\n>>>>>>> REPLACE`;
  const applied = applySearchReplace(fileContent, ops);
  if (!applied.success) {
    throw new Error(`applySearchReplace failed: ${applied.error}`);
  }
  return applied.content!;
}

// ── MAX_OLD_STRING_RATIO guard ─────────────────────────────────

const MAX_OLD_STRING_RATIO = 0.8;

function assertNotFullFileRewrite(
  fileContent: string,
  oldString: string,
  label: string,
): void {
  const ratio = oldString.length / fileContent.length;
  if (ratio > MAX_OLD_STRING_RATIO) {
    throw new Error(
      `${label}: old_string covers ${(ratio * 100).toFixed(1)}% of the file ` +
        `(max allowed: ${MAX_OLD_STRING_RATIO * 100}%). This looks like a full-file rewrite.`,
    );
  }
}

// ── Model matrix ───────────────────────────────────────────────

const ALL_MODELS: Array<{
  provider: EvalProvider;
  modelName: string;
  label: string;
  temperature: number;
}> = [
  {
    provider: "anthropic",
    modelName: SONNET_4_6,
    label: "Claude Sonnet 4.6",
    temperature: 0,
  },
  {
    provider: "openai",
    modelName: GPT_5_4,
    label: "GPT 5.4",
    temperature: 1,
  },
  {
    provider: "google",
    modelName: GEMINI_3_FLASH,
    label: "Gemini 3 Flash",
    temperature: 1,
  },
];

// Narrow the model matrix with `EVAL_MODEL=<substring>` (case-insensitive).
// Matches against either the label or the underlying model name so that
// `EVAL_MODEL=sonnet`, `EVAL_MODEL=gpt`, or `EVAL_MODEL=gemini` all work.
const MODEL_FILTER = process.env.EVAL_MODEL?.trim().toLowerCase();
const MODELS = MODEL_FILTER
  ? ALL_MODELS.filter(
      (m) =>
        m.label.toLowerCase().includes(MODEL_FILTER) ||
        m.modelName.toLowerCase().includes(MODEL_FILTER),
    )
  : ALL_MODELS;

if (MODEL_FILTER && MODELS.length === 0) {
  throw new Error(
    `EVAL_MODEL="${process.env.EVAL_MODEL}" matched no models. ` +
      `Available labels: ${ALL_MODELS.map((m) => m.label).join(", ")}`,
  );
}

// ── Case runner ────────────────────────────────────────────────

async function runCase(
  c: EvalCase,
  provider: EvalProvider,
  modelName: string,
  label: string,
  temperature: number,
): Promise<void> {
  const runTimestamp = new Date().toISOString();
  const llmStartMs = Date.now();
  let lastStepEndMs = llmStartMs;
  const requests: LLMRequestRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let totalDurationMs = 0;
  let responseModelId: string | null = null;
  let judgeRecord: JudgeRecord | null = null;
  let passed = false;
  let errorMessage: string | null = null;

  let currentContent = c.fileContent;
  const toolCallLog: Array<{
    file_path: string;
    old_string: string;
    new_string: string;
  }> = [];

  try {
    const result = await generateText({
      model: getEvalModel(provider, modelName),
      temperature,
      stopWhen: stepCountIs(100),
      system:
        "You are a precise code editor. When asked to change a file, " +
        "use the search_replace tool. You may call it multiple times " +
        "to make sequential edits. Do not explain.",
      messages: [
        {
          role: "user",
          content: `File: ${c.fileName}\n\`\`\`\n${c.fileContent}\n\`\`\`\n\n${c.prompt}`,
        },
      ],
      tools: {
        search_replace: {
          description: searchReplaceTool.description,
          inputSchema: searchReplaceTool.inputSchema,
          execute: async (args) => {
            const callTimestamp = new Date().toISOString();
            const fileBefore = currentContent;
            toolCallLog.push(args);
            expect(
              args.file_path,
              `${label} / ${c.name} targeted wrong file`,
            ).toBe(c.fileName);
            assertNotFullFileRewrite(
              currentContent,
              args.old_string,
              `${label} / ${c.name}`,
            );
            currentContent = applyEdit(currentContent, args);
            const callIndex = toolCalls.length;
            toolCalls.push({
              timestamp: callTimestamp,
              index: callIndex,
              toolName: "search_replace",
              filePath: args.file_path,
              oldString: args.old_string,
              newString: args.new_string,
              fileBefore,
              fileAfter: currentContent,
              diff: createUnifiedDiff(fileBefore, currentContent, {
                oldLabel: `${args.file_path} (before call ${callIndex + 1})`,
                newLabel: `${args.file_path} (after call ${callIndex + 1})`,
              }),
            });
            return "Edit applied successfully.";
          },
        },
      },
      onStepFinish: (step) => {
        const now = Date.now();
        requests.push({
          stepIndex: requests.length,
          timestamp: step.response.timestamp.toISOString(),
          durationMs: now - lastStepEndMs,
          usage: normalizeUsage(step.usage),
          finishReason: step.finishReason ?? null,
        });
        lastStepEndMs = now;
      },
    });

    totalDurationMs = Date.now() - llmStartMs;
    totalUsage = normalizeUsage(result.totalUsage);
    responseModelId = result.response.modelId ?? null;

    const totalCalls = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);
    console.log(`\n[${label}] ${c.name} — ${totalCalls} tool call(s):`);
    for (const [i, tc] of toolCallLog.entries()) {
      console.log(
        `  Call ${i + 1}: file_path=${tc.file_path}, ` +
          `old_string (${tc.old_string.length} chars), ` +
          `new_string (${tc.new_string.length} chars)`,
        `${Date.now().toLocaleString()}`,
      );
    }

    expect(totalCalls, `${label} made no search_replace calls`).toBeGreaterThan(
      0,
    );

    for (const check of c.structuralChecks ?? []) {
      console.log(
        `  Structural check "${check}": ${currentContent.includes(check) ? "PASS" : "FAIL"}`,
      );
      expect(
        currentContent,
        `Structural check failed: expected output to contain "${check}"`,
      ).toContain(check);
    }

    console.log(
      `\n[${label}] ${c.name} — final content (${currentContent.length} chars, first 500):\n${currentContent.slice(0, 500)}...`,
    );

    console.log(`\n[${label}] ${c.name} — calling judge...`);
    judgeRecord = await judgeResult(c.fileContent, c.prompt, currentContent);
    console.log(
      `\n[${label}] ${c.name} — judge verdict: ${judgeRecord.pass ? "PASS" : "FAIL"}\n${judgeRecord.explanation}`,
    );

    expect(
      judgeRecord.pass,
      `Judge (${JUDGE_LABEL}) said FAIL for ${label}:\n${judgeRecord.explanation}`,
    ).toBe(true);
    passed = true;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    if (totalDurationMs === 0) totalDurationMs = Date.now() - llmStartMs;
    throw err;
  } finally {
    recordEvalRun({
      timestamp: runTimestamp,
      suite: SUITE_NAME,
      caseName: c.name,
      model: { label, provider, modelName, responseModelId },
      llm: {
        totalDurationMs,
        totalUsage,
        requestCount: requests.length,
        requests,
      },
      toolCalls,
      diff: createUnifiedDiff(c.fileContent, currentContent, {
        oldLabel: `${c.fileName} (original)`,
        newLabel: `${c.fileName} (modified)`,
      }),
      judge: judgeRecord,
      passed,
      errorMessage,
    });
  }
}

// ── Test runner ────────────────────────────────────────────────

for (const { provider, modelName, label, temperature } of MODELS) {
  describe.skipIf(!hasDyadProKey())(`search_replace eval — ${label}`, () => {
    for (const c of CASES) {
      it.concurrent(c.name, async () => {
        try {
          await runCase(c, provider, modelName, label, temperature);
        } catch (err) {
          console.error(
            `\n[${label}] ${c.name} — ERROR: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      });
    }
  });
}
