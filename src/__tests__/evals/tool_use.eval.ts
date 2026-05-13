import { describe, it } from "vitest";
import { generateText, stepCountIs, type Tool } from "ai";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { searchReplaceTool } from "@/pro/main/ipc/handlers/local_agent/tools/search_replace";
import { writeFileTool } from "@/pro/main/ipc/handlers/local_agent/tools/write_file";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { escapeSearchReplaceMarkers } from "@/pro/shared/search_replace_markers";
import { constructLocalAgentPrompt } from "@/prompts/local_agent_prompt";
import {
  SONNET_4_6,
  GEMINI_3_FLASH,
} from "@/ipc/shared/language_model_constants";
import {
  GPT_5_4,
  getEvalModel,
  hasDyadProKey,
  type EvalProvider,
} from "./helpers/get_eval_model";
import {
  normalizeUsage,
  recordDirFor,
  recordEvalRun,
  type LLMRequestRecord,
  type ToolCallRecord,
  type JudgeRecord,
} from "./helpers/eval_recorder";
import { createUnifiedDiff } from "./helpers/unified_diff";
import {
  SIMPLE_SEARCH_REPLACE_SYSTEM_PROMPT,
  SEARCH_REPLACE_FEW_SYSTEM_PROMPT,
  PRO_AGENT_EXPERIMENTAL_SYSTEM_PROMPT,
} from "./helpers/prompts";

// ── Fixture loader ─────────────────────────────────────────────

const FIXTURES_DIR = resolve(__dirname, "fixtures");

function loadFixture(filename: string): string {
  return readFileSync(resolve(FIXTURES_DIR, filename), "utf-8");
}

// Models sometimes emit paths like `./foo.ts`, `src/foo.ts`, or even Windows-
// style `.\foo.ts` / `src\foo.ts` instead of the bare fixture filename. Since
// each case targets a single known file, a basename match is sufficient and
// avoids penalizing harmless path formatting differences across models. We
// normalize backslashes to forward slashes first because node's posix
// `basename` treats `\` as a regular filename character.
function pathMatchesCase(got: string | undefined, expected: string): boolean {
  if (!got) return false;
  const normalize = (p: string) => basename(p.replace(/\\/g, "/"));
  return normalize(got) === normalize(expected);
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
    structuralChecks: ["useState", "useEffect"],
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
    name: "Extract multiple shared helpers from duplicated reporting logic",
    fileName: "report_builders.ts",
    fileContent: loadFixture("report_builders.ts"),
    prompt:
      "The exported report functions in this file repeat several patterns. Extract these " +
      "into named helper functions at the top of the module (below the interfaces and " +
      "MONTH_NAMES) and reuse them throughout:\n\n" +
      "1. A helper `filterByDateField<T>(items: T[], range: ReportRange, getDate: (item: T) => string): T[]` " +
      "that filters items whose ISO date (extracted via `getDate`) falls in `[range.from, range.to)`. " +
      "Every `Date.parse` range-filter block should call this helper.\n" +
      "2. A helper `formatUsd(amount: number): string` that returns the USD-formatted string " +
      "currently produced by the repeated `new Intl.NumberFormat(...).format(amount)` calls. " +
      "Every such call should go through this helper.\n" +
      "3. A helper `formatRangeLabel(range: ReportRange): string` that returns the " +
      '`"Jan 1, 2025 – Feb 1, 2025"`-style label built from MONTH_NAMES. Every occurrence ' +
      "of that block should go through this helper.\n" +
      "4. A helper `sumBy<T>(items: T[], get: (item: T) => number): number` that returns the " +
      "sum, and a helper `groupSumBy<T>(items: T[], getKey: (item: T) => string, getValue: (item: T) => number): Map<string, number>` " +
      "that builds a keyed-sum Map. Use them wherever a manual `for`-loop *revenue/amount " +
      "sum* or *keyed-sum* Map accumulation appears (for example summing `unitPrice * quantity`, " +
      "`amount`, or `mrr`). Do NOT force count-accumulation or conditional-tally loops " +
      "through these helpers — leave counts (e.g. `countByReason`, `countByPlan`) and " +
      "conditional counters (e.g. `churnRate`'s `activeAtStart` / `canceledInRange`) as " +
      "manual loops.\n\n" +
      "Preserve every exported function's signature and return type exactly. Do not change " +
      "sort order, rounding, or numeric results. Do not remove any exported function.",
    structuralChecks: [
      "function filterByDateField",
      "function formatUsd",
      "function formatRangeLabel",
      "function sumBy",
      "function groupSumBy",
      "filterByDateField(",
      "formatUsd(",
      "formatRangeLabel(",
    ],
  },
  {
    name: "Migrate Contact schema: split name into firstName and lastName",
    fileName: "contact_book.ts",
    fileContent: loadFixture("contact_book.ts"),
    prompt:
      "Replace the `name: string` field on the `Contact` interface with two separate " +
      "fields: `firstName: string` and `lastName: string`. Update every function in the " +
      "file to use the new fields. Specifically:\n\n" +
      "- `createContact` must accept `firstName` and `lastName` in its input (instead of " +
      "`name`), each trimmed.\n" +
      "- `fromCsv` must read two columns `firstName,lastName` from the header instead of " +
      "a single `name` column. `toCsv` must emit the same two columns. The CSV header must " +
      "start with `firstName,lastName,email,phone,tags,starred`.\n" +
      '- `displayName` must return `"${firstName} ${lastName}"` (single space, no trim ' +
      "beyond what is already stored).\n" +
      '- `lastFirstDisplay` must return `"${lastName}, ${firstName}"` directly — no more ' +
      "string splitting.\n" +
      "- `initials` must return `firstName.charAt(0).toUpperCase() + lastName.charAt(0).toUpperCase()` " +
      "— no splitting, no length guards.\n" +
      '- `greetingFor` must greet using `firstName` directly (fall back to `"there"` if ' +
      "`firstName` is empty). \n" +
      "- `searchByName` must match the query (case-insensitive) against either `firstName` " +
      "OR `lastName` (not the concatenation).\n" +
      "- `sortByName` must sort by `lastName` then `firstName` (both case-insensitive).\n" +
      "- `sortByLastName` must sort by `lastName` (case-insensitive), no more splitting.\n" +
      "- `dedupeByName` must treat two contacts as duplicates when both their `firstName` " +
      "and `lastName` match case-insensitively.\n" +
      '- `validateContact` must report `"firstName is required"` if `firstName.trim()` is ' +
      'empty, and `"lastName is required"` if `lastName.trim()` is empty (keep the email ' +
      "check unchanged).\n" +
      '- `formatLine` must render `"${firstName} ${lastName} <${email}>"` (with the ' +
      "existing star prefix).\n\n" +
      "Do not leave any reference to a `.name` property on a Contact anywhere in the file. " +
      "Do not change any other public API (function names, return types, other fields).",
    structuralChecks: [
      "firstName: string",
      "lastName: string",
      "firstName,lastName,email,phone,tags,starred",
      "firstName is required",
      "lastName is required",
    ],
  },
  {
    name: "Replace Math.pow with exponentiation operator",
    fileName: "stat_utils.ts",
    fileContent: loadFixture("stat_utils.ts"),
    prompt:
      "Replace every `Math.pow(base, exponent)` call in this file with the " +
      "JavaScript exponentiation operator `**`. When `base` is a compound " +
      "expression (i.e. anything other than a bare identifier or numeric literal), " +
      "wrap it in parentheses so operator precedence is preserved. Single " +
      "identifiers and numeric literals do not need extra parentheses. " +
      "The `correlation` function is currently duplicated. Delete all but one declaration. " +
      "Additionally, fix the currently incorrect `median` function." +
      "Do not change any other code.",
    structuralChecks: ["** 2", "** 3", "** 4"],
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
  {
    name: "Restrict moderator from managing users",
    fileName: "permissions.ts",
    fileContent: loadFixture("permissions.ts"),
    prompt:
      "In `ModeratorPolicy`, change `canManageUsers` to return `false` instead of `true`. " +
      "Do not modify any other methods or classes.",
    structuralChecks: [],
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
  abortSignal?: AbortSignal,
): Promise<JudgeRecord> {
  const startMs = Date.now();
  const result = await generateText({
    model: getEvalModel(JUDGE_PROVIDER, JUDGE_MODEL),
    temperature: 1,
    abortSignal,
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

// ── Tool apply helpers ─────────────────────────────────────────

function applySearchReplaceEdit(
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

// ── Tool factories ─────────────────────────────────────────────
//
// Each factory returns an AI-SDK tool whose `execute` mutates the
// shared `state.content` box and appends a `ToolCallRecord`. The
// factories take closures over `state` and the case so the tool
// stays bound to this single run.

interface ToolRunState {
  content: string;
  toolCalls: ToolCallRecord[];
  abortSignal?: AbortSignal;
}

function makeRecord(
  toolName: string,
  filePath: string,
  args: Record<string, unknown>,
  fileBefore: string,
  fileAfter: string,
  index: number,
  opts: { succeeded?: boolean; error?: string | null } = {},
): ToolCallRecord {
  const succeeded = opts.succeeded ?? true;
  return {
    timestamp: new Date().toISOString(),
    index,
    toolName,
    filePath,
    args,
    fileBefore,
    fileAfter,
    diff: createUnifiedDiff(fileBefore, fileAfter, {
      oldLabel: `${filePath} (before call ${index + 1})`,
      newLabel: `${filePath} (after call ${index + 1})`,
    }),
    succeeded,
    error: succeeded ? null : (opts.error ?? null),
  };
}

function searchReplaceHarnessTool(
  state: ToolRunState,
  c: EvalCase,
  label: string,
): Tool {
  return {
    description: searchReplaceTool.description,
    inputSchema: searchReplaceTool.inputSchema,
    execute: async (args) => {
      const fileBefore = state.content;
      const recordArgs = {
        file_path: args.file_path,
        old_string: args.old_string,
        new_string: args.new_string,
      };
      try {
        if (!pathMatchesCase(args.file_path, c.fileName)) {
          throw new Error(
            `${label} / ${c.name} search_replace targeted wrong file: ` +
              `got "${args.file_path}", expected "${c.fileName}"`,
          );
        }
        state.content = applySearchReplaceEdit(state.content, args);
        state.toolCalls.push(
          makeRecord(
            "search_replace",
            args.file_path,
            recordArgs,
            fileBefore,
            state.content,
            state.toolCalls.length,
          ),
        );
        return `Successfully applied edits to ${args.file_path}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.toolCalls.push(
          makeRecord(
            "search_replace",
            args.file_path ?? c.fileName,
            recordArgs,
            fileBefore,
            fileBefore,
            state.toolCalls.length,
            { succeeded: false, error: message },
          ),
        );
        throw err;
      }
    },
  };
}

function writeFileHarnessTool(
  state: ToolRunState,
  c: EvalCase,
  label: string,
): Tool {
  return {
    description: writeFileTool.description,
    inputSchema: writeFileTool.inputSchema,
    execute: async (args) => {
      const fileBefore = state.content;
      const recordArgs = {
        path: args.path,
        content: args.content,
        description: args.description ?? "",
      };
      try {
        if (!pathMatchesCase(args.path, c.fileName)) {
          throw new Error(
            `${label} / ${c.name} write_file targeted wrong file: ` +
              `got "${args.path}", expected "${c.fileName}"`,
          );
        }
        state.content = args.content;
        state.toolCalls.push(
          makeRecord(
            "write_file",
            args.path,
            recordArgs,
            fileBefore,
            state.content,
            state.toolCalls.length,
          ),
        );
        return `Successfully wrote ${args.path}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.toolCalls.push(
          makeRecord(
            "write_file",
            args.path ?? c.fileName,
            recordArgs,
            fileBefore,
            fileBefore,
            state.toolCalls.length,
            { succeeded: false, error: message },
          ),
        );
        throw err;
      }
    },
  };
}

// ── Suite configs ──────────────────────────────────────────────

interface SuiteConfig {
  name: string;
  displayName: string;
  systemPrompt: string;
  buildTools: (
    state: ToolRunState,
    c: EvalCase,
    label: string,
  ) => Record<string, Tool>;
}

const SUITES: SuiteConfig[] = [
  {
    name: "search_replace",
    displayName: "search_replace",
    systemPrompt: SIMPLE_SEARCH_REPLACE_SYSTEM_PROMPT,
    buildTools: (state, c, label) => ({
      search_replace: searchReplaceHarnessTool(state, c, label),
    }),
  },
  {
    name: "search_replace_few",
    displayName: "search_replace_few (minimize call count)",
    systemPrompt: SEARCH_REPLACE_FEW_SYSTEM_PROMPT,
    buildTools: (state, c, label) => ({
      search_replace: searchReplaceHarnessTool(state, c, label),
    }),
  },
  {
    name: "basic_agent",
    displayName: "basic_agent (search_replace + write_file)",
    systemPrompt: constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
    }),
    buildTools: (state, c, label) => ({
      search_replace: searchReplaceHarnessTool(state, c, label),
      write_file: writeFileHarnessTool(state, c, label),
    }),
  },
  {
    name: "pro_agent",
    displayName: "pro_agent (search_replace + write_file)",
    systemPrompt: constructLocalAgentPrompt(undefined),
    buildTools: (state, c, label) => ({
      search_replace: searchReplaceHarnessTool(state, c, label),
      write_file: writeFileHarnessTool(state, c, label),
    }),
  },
  {
    // Mirrors pro_agent but uses a standalone copy of the prompt
    // (see helpers/prompts.ts) so prompt variations can be recorded
    // without modifying the production prompt.
    name: "pro_agent_experimental",
    displayName: "pro_agent_experimental (pro_agent with editable prompt copy)",
    systemPrompt: PRO_AGENT_EXPERIMENTAL_SYSTEM_PROMPT,
    buildTools: (state, c, label) => ({
      search_replace: searchReplaceHarnessTool(state, c, label),
      write_file: writeFileHarnessTool(state, c, label),
    }),
  },
];

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

// ── Case runner ────────────────────────────────────────────────

async function runCase(
  suite: SuiteConfig,
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
  let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let totalDurationMs = 0;
  let responseModelId: string | null = null;
  let judgeRecord: JudgeRecord | null = null;
  let passed = false;
  let errorMessage: string | null = null;

  const systemPrompt = suite.systemPrompt;
  const userPrompt = `File: ${c.fileName}\n\`\`\`\n${c.fileContent}\n\`\`\`\n\n${c.prompt}`;

  // Internal timeout fires slightly before vitest's testTimeout so the
  // finally block still runs and we capture a partial record (tool calls,
  // LLM requests so far, current file state) instead of losing everything
  // to a hard vitest timeout. Keep this strictly less than testTimeout in
  // vitest.eval.config.ts.
  const INTERNAL_TIMEOUT_MS = 330_000;
  const abortController = new AbortController();

  const state: ToolRunState = {
    content: c.fileContent,
    toolCalls: [],
    abortSignal: abortController.signal,
  };
  const timeoutHandle = setTimeout(() => {
    abortController.abort(
      new Error(
        `runCase internal timeout: exceeded ${INTERNAL_TIMEOUT_MS}ms budget`,
      ),
    );
  }, INTERNAL_TIMEOUT_MS);

  try {
    const result = await generateText({
      model: getEvalModel(provider, modelName),
      temperature,
      stopWhen: stepCountIs(100),
      abortSignal: abortController.signal,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
      tools: suite.buildTools(state, c, label),
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
    console.log(
      `\n[${suite.name} / ${label}] ${c.name} — ${totalCalls} tool call(s):`,
    );
    for (const [i, tc] of state.toolCalls.entries()) {
      const argSummary = Object.entries(tc.args)
        .map(([k, v]) =>
          typeof v === "string" ? `${k} (${v.length} chars)` : `${k}=${v}`,
        )
        .join(", ");
      console.log(
        `  Call ${i + 1}: ${tc.toolName} file=${tc.filePath}, ${argSummary}`,
      );
    }

    const successfulCalls = state.toolCalls.filter((tc) => tc.succeeded).length;
    if (successfulCalls === 0) {
      throw new Error(
        `${label} made no successful tool calls (attempted ${totalCalls})`,
      );
    }

    for (const check of c.structuralChecks ?? []) {
      const ok = state.content.includes(check);
      console.log(`  Structural check "${check}": ${ok ? "PASS" : "FAIL"}`);
      if (!ok) {
        throw new Error(
          `Structural check failed: expected output to contain "${check}"`,
        );
      }
    }

    const recordDir = recordDirFor(suite.name, c.name, label);
    console.log(
      `\n[${suite.name} / ${label}] ${c.name} — final content (${state.content.length} chars, first 500):\n${state.content.slice(0, 500)}...\n` +
        `  Full record will be written to: ${recordDir}`,
    );

    console.log(`\n[${suite.name} / ${label}] ${c.name} — calling judge...`);
    judgeRecord = await judgeResult(
      c.fileContent,
      c.prompt,
      state.content,
      abortController.signal,
    );
    console.log(
      `\n[${suite.name} / ${label}] ${c.name} — judge verdict: ${judgeRecord.pass ? "PASS" : "FAIL"}\n${judgeRecord.explanation}`,
    );

    if (!judgeRecord.pass) {
      throw new Error(
        `Judge (${JUDGE_LABEL}) said FAIL for ${label}:\n${judgeRecord.explanation}`,
      );
    }
    passed = true;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    if (totalDurationMs === 0) totalDurationMs = Date.now() - llmStartMs;
    // generateText throws before we can read result.totalUsage, but any
    // already-completed steps were captured in `requests` via onStepFinish.
    // Sum those so failed runs still report real token consumption instead
    // of zeros — otherwise cost and per-model comparisons get skewed for
    // exactly the failure cases we most care about analyzing.
    if (totalUsage.totalTokens === 0 && requests.length > 0) {
      totalUsage = requests.reduce(
        (acc, r) => ({
          inputTokens: acc.inputTokens + r.usage.inputTokens,
          outputTokens: acc.outputTokens + r.usage.outputTokens,
          totalTokens: acc.totalTokens + r.usage.totalTokens,
        }),
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
    await recordEvalRun({
      timestamp: runTimestamp,
      suite: suite.name,
      caseName: c.name,
      model: { label, provider, modelName, responseModelId },
      prompt: {
        system: systemPrompt,
        instructions: c.prompt,
        user: userPrompt,
      },
      file: {
        name: c.fileName,
        before: c.fileContent,
        after: state.content,
      },
      llm: {
        totalDurationMs,
        totalUsage,
        requestCount: requests.length,
        requests,
      },
      toolCalls: state.toolCalls,
      diff: createUnifiedDiff(c.fileContent, state.content, {
        oldLabel: `${c.fileName} (original)`,
        newLabel: `${c.fileName} (modified)`,
      }),
      judge: judgeRecord,
      passed,
      errorMessage,
    });
  }
}

// ── Filters + test runner ──────────────────────────────────────
//
// `EVAL_SUITE` and `EVAL_MODEL` are both required — running every suite
// against every model by accident is expensive, so the caller must opt
// in explicitly. Use `all` to mean "run everything". `EVAL_SUITE` matches
// suite names exactly (comma-separated for multiple, e.g.
// `EVAL_SUITE=search_replace,basic_agent`) so that `search_replace` does
// not also pick up `search_replace_few`. `EVAL_MODEL` is a
// case-insensitive substring match against model label or id.

const SUITE_FILTER_RAW = process.env.EVAL_SUITE?.trim();
const MODEL_FILTER_RAW = process.env.EVAL_MODEL?.trim();

if (!SUITE_FILTER_RAW || !MODEL_FILTER_RAW) {
  const missingEnv: string[] = [];
  if (!SUITE_FILTER_RAW) missingEnv.push("EVAL_SUITE");
  if (!MODEL_FILTER_RAW) missingEnv.push("EVAL_MODEL");
  const suiteOptions = SUITES.map((s) => s.name).join(", ");
  const modelOptions = ALL_MODELS.map((m) => m.label).join(", ");
  console.warn(
    `\n⚠️  Eval suite not running: ${missingEnv.join(" and ")} not set.\n` +
      `  Set EVAL_SUITE to "all" or an exact name (comma-separated for multiple) from: ${suiteOptions}\n` +
      `  Set EVAL_MODEL to "all" or a substring of a label: ${modelOptions}\n` +
      `  Example:\n` +
      `    EVAL_SUITE=all EVAL_MODEL=all DYAD_PRO_API_KEY="..." npm run eval\n`,
  );
  // Register a single skipped describe so vitest still reports something
  // coherent (rather than "no tests found").
  describe.skip("eval suite — configuration required", () => {
    it("set EVAL_SUITE and EVAL_MODEL (use 'all' to run every suite/model)", () => {});
  });
} else {
  const suiteFilter = SUITE_FILTER_RAW.toLowerCase();
  const requestedSuiteNames =
    suiteFilter === "all"
      ? null
      : new Set(
          suiteFilter
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== ""),
        );
  const ACTIVE_SUITES =
    requestedSuiteNames === null
      ? SUITES
      : SUITES.filter((s) => requestedSuiteNames.has(s.name.toLowerCase()));

  // Surface filter misconfiguration as a clean failing test rather than
  // crashing module load with an opaque stack trace. The describe block
  // gives vitest a place to attach the (carefully written) error message.
  const configErrors: string[] = [];
  if (ACTIVE_SUITES.length === 0) {
    configErrors.push(
      `EVAL_SUITE="${SUITE_FILTER_RAW}" matched no suites. ` +
        `Available: ${SUITES.map((s) => s.name).join(", ")} (or "all"). ` +
        `Use exact names, comma-separated for multiple.`,
    );
  } else if (requestedSuiteNames !== null) {
    const matched = new Set(ACTIVE_SUITES.map((s) => s.name.toLowerCase()));
    const unknown = [...requestedSuiteNames].filter((n) => !matched.has(n));
    if (unknown.length > 0) {
      configErrors.push(
        `EVAL_SUITE contains unknown suite name(s): ${unknown.join(", ")}. ` +
          `Available: ${SUITES.map((s) => s.name).join(", ")} (or "all").`,
      );
    }
  }

  const modelFilter = MODEL_FILTER_RAW.toLowerCase();
  const MODELS =
    modelFilter === "all"
      ? ALL_MODELS
      : ALL_MODELS.filter(
          (m) =>
            m.label.toLowerCase().includes(modelFilter) ||
            m.modelName.toLowerCase().includes(modelFilter),
        );

  if (MODELS.length === 0) {
    configErrors.push(
      `EVAL_MODEL="${MODEL_FILTER_RAW}" matched no models. ` +
        `Available labels: ${ALL_MODELS.map((m) => m.label).join(", ")} (or "all")`,
    );
  }

  if (configErrors.length > 0) {
    describe("eval suite — configuration error", () => {
      for (const msg of configErrors) {
        it(msg.split(".")[0], () => {
          throw new Error(msg);
        });
      }
    });
  } else {
    for (const suite of ACTIVE_SUITES) {
      for (const { provider, modelName, label, temperature } of MODELS) {
        describe.skipIf(!hasDyadProKey())(
          `${suite.displayName} — ${label}`,
          () => {
            for (const c of CASES) {
              it.concurrent(c.name, async () => {
                try {
                  await runCase(
                    suite,
                    c,
                    provider,
                    modelName,
                    label,
                    temperature,
                  );
                } catch (err) {
                  console.error(
                    `\n[${suite.name} / ${label}] ${c.name} — ERROR: ${err instanceof Error ? err.message : String(err)}`,
                  );
                  throw err;
                }
              });
            }
          },
        );
      }
    }
  }
}
