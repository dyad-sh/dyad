# LLM Eval: `search_replace` Tool Use

## Summary

Add a new **evals** test suite (~12 cases) that verifies real LLMs (Claude Sonnet 4.6, GPT 5.4, Gemini 3 Flash) can correctly invoke the `search_replace` tool when given a source file and a natural-language edit instruction. Cases are split into two tiers: **exact-match** cases (~7) with a single correct output asserted byte-for-byte, and **judge-verified** cases (~5) for complex refactors where multiple valid outputs exist, evaluated by a GPT 5.4 judge call. The eval runs against the **Dyad Engine** (which proxies all providers) using a single `DYAD_PRO_API_KEY`, reuses the production `searchReplaceTool` definition (schema + description) and the `applySearchReplace` processor, and is isolated behind a new `npm run eval` script so it never runs as part of normal CI. All models are accessed via the chat completions API through `createDyadEngine`, with a custom fetch adapter that bridges the Dyad Engine's streaming-only behavior with the AI SDK's non-streaming `generateText` calls.

## Problem Statement

`search_replace` is intended to eventually become the primary file-editing tool for Dyad's local agent, but today LLMs frequently fail to use it correctly. Because of this, Dyad currently leans on `edit_file` as the workhorse — and until we can measure `search_replace` tool-call correctness across models, we have no principled way to know when (or whether) it's ready to take over.

The existing unit tests (`search_replace.spec.ts`) only exercise the tool's `execute` path against mocked file contents; they tell us nothing about whether any real model can _decide_ to use the tool and _emit the right arguments_ when it does. This plan adds that missing signal.

We need a lightweight eval harness that:

1. Sends a real prompt + file snippet to each target model.
2. Captures the `search_replace` tool call the model produces.
3. Applies that tool call via the real `applySearchReplace` processor.
4. Asserts correctness — either via exact-match comparison or a judge model for complex cases.

## Scope

### In Scope

- New directory `src/__tests__/evals/` with a small reusable helper for instantiating LLM clients via the Dyad Engine.
- New eval file `src/__tests__/evals/search_replace_tool_use.eval.ts` containing ~12 eval cases in two tiers: ~7 exact-match and ~5 judge-verified.
- Target models: **`claude-sonnet-4-6`** (`SONNET_4_6`), **`gpt-5.4`** (`GPT_5_4`), **`gemini-3-flash-preview`** (`GEMINI_3_FLASH`). All routed through the Dyad Engine's chat completions endpoint using a single `DYAD_PRO_API_KEY`. All model names are imported from `src/ipc/shared/language_model_constants.ts` so the eval tracks Dyad's canonical identifiers and cannot drift.
- Separate `vitest.eval.config.ts` with `environment: "node"`, long `testTimeout`, and an `include` pattern of `src/__tests__/evals/**/*.eval.ts`.
- New `npm run eval` script — the eval is **not** included in `npm test`.
- `describe.skipIf` gating so the entire eval suite is skipped when `DYAD_PRO_API_KEY` is missing.
- Reuse of `searchReplaceTool.inputSchema` and `searchReplaceTool.description` — the LLM sees the exact same tool contract it sees in production.
- Reuse of `applySearchReplace` from `src/pro/main/ipc/processors/search_replace_processor.ts` for semantic assertion — the eval verifies that the edit _actually produces the right file_, not just that the args look plausible.

### Out of Scope

- Running the eval in CI. This is a local-only / on-demand quality gate. A follow-up can add a nightly workflow that sets the Dyad Pro key from GitHub secrets.
- Testing every model in Dyad's catalog. We test one representative model per major provider.
- Testing other file-edit tools (`edit_file`, `write_file`). The same harness can be extended to them in a follow-up.
- A scoring / regression-tracking dashboard. Pass/fail is sufficient for v1.
- Exercising the full local-agent handler (`local_agent_handler.ts`) — we bypass it entirely and call `generateText` directly because the handler is coupled to Electron, the DB, settings, IPC, consent dialogs, and streaming XML rendering. See "Why not reuse `buildAgentToolSet` / `local_agent_handler`?" below.

## Technical Design

### Architecture

A single eval file drives a matrix of **(model × test case)**. For each combination:

1. Instantiate a `LanguageModel` via `createDyadEngine` from `llm_engine_provider.ts`.
2. Call `generateText` with:
   - The eval's file content embedded in the user message.
   - A minimal system prompt instructing the model to use `search_replace`.
   - A **single tool** — `search_replace` — wrapped to match the AI SDK v5 shape used by `buildAgentToolSet` (`{ description, inputSchema }`). For exact-match cases, we omit `execute` so the AI SDK returns the tool call for direct inspection. For judge-verified cases, we provide an `execute` function and set `stopWhen: stepCountIs(10)` so the model can make multiple sequential edits.
3. Extract the tool call from `result.toolCalls`.
4. Apply it via `applySearchReplace` against the original file content.
5. Assert correctness: for exact-match cases, compare byte-for-byte against `expectedContent`; for judge-verified cases, run `structuralChecks` then call the GPT 5.4 judge for a PASS/FAIL verdict.

This mirrors, at the protocol level, what `buildAgentToolSet` does in production — we use the **same schema**, the **same description**, and the **same processor** — but sidesteps the Electron / IPC / DB machinery.

### Why not reuse `buildAgentToolSet` / `getModelClient` / `local_agent_handler`?

Each of these was considered and rejected for specific reasons:

- **`local_agent_handler.ts`** is a 1,600-line orchestrator tightly coupled to Electron IPC events, the SQLite chat DB, consent callbacks, XML streaming, telemetry, and file-edit tracking. Running it in a unit test requires dozens of mocks (see `src/__tests__/local_agent_handler.test.ts`) and still only exercises a fake stream. Using it for an eval would add enormous complexity for no signal gain.
- **`buildAgentToolSet`** (`tool_definitions.ts:412`) requires an `AgentContext` with `event`, `appPath`, `requireConsent`, `onXmlStream`, etc. We do not want consent dialogs, file writes, or XML streaming during an eval. Instead we inline the ~3 lines `buildAgentToolSet` uses to wrap a `ToolDefinition` for the AI SDK (`{ description: tool.description, inputSchema: tool.inputSchema }`), which is the part worth reusing.
- **`getModelClient`** (`get_model_client.ts`) pulls in `electron-log`, `getLanguageModelProviders` (hits the settings DB), Vertex service-account JSON handling, Ollama URL resolution, and a `UserSettings` object. For a standalone Node process this is all dead weight. Instead, the eval calls `createDyadEngine` from `llm_engine_provider.ts` directly — the same factory `getModelClient` uses internally when Dyad Pro is enabled — but with minimal options (just the API key and base URL).

**What _is_ reused from Dyad:**

- `searchReplaceTool.inputSchema` — zod schema identical to production.
- `searchReplaceTool.description` — LLM sees the exact same instructions.
- `applySearchReplace` — same processor that runs in production.
- `createDyadEngine` from `llm_engine_provider.ts` — same factory production uses for Dyad Pro. The eval calls it with `DYAD_PRO_API_KEY` and the default engine URL, bypassing all Electron/DB/settings coupling.
- Model IDs (`SONNET_4_6`, `GPT_5_4`, `GEMINI_3_FLASH`) imported from `language_model_constants.ts` so they can't drift. `GPT_5_4` is a new constant added as part of this plan (see Phase 1).
- Gateway prefixes from `CLOUD_PROVIDERS` in `language_model_constants.ts` (`""` for OpenAI, `"anthropic/"` for Anthropic, `"gemini/"` for Google) — these are prepended to model names exactly as `getModelClient` does at `get_model_client.ts:107`.

**Why chat completions for all models (not `.responses()` for OpenAI):** Production uses `provider.responses()` for OpenAI in local-agent mode, but the eval uses `provider()` (chat completions) for all providers. The Dyad Engine only supports streaming (`stream: true`), and the eval's fetch adapter (`sseToNonStreamingResponse`) reassembles SSE chat-completion chunks into a single JSON response for the SDK's non-streaming `generateText` path. The OpenAI Responses API uses a different SSE event format (`response.created`, `response.completed`, etc.) that would require a separate adapter. Since the eval tests model quality (correct tool calls), not transport-layer compatibility, using chat completions for all providers is sufficient.

### Components Affected

- **New file:** `vitest.eval.config.ts` — separate vitest config.
- **New file:** `src/__tests__/evals/helpers/get_eval_model.ts` — thin helper that wraps `createDyadEngine` for the eval.
- **New file:** `src/__tests__/evals/search_replace_tool_use.eval.ts` — the eval suite itself.
- **Modified:** `package.json` — add an `eval` script.
- **Modified:** `src/ipc/shared/language_model_constants.ts` — add `GPT_5_4` constant and `MODEL_OPTIONS` entry.
- **No changes to:** production code in `src/pro/main/ipc/handlers/local_agent/` or `src/ipc/utils/get_model_client.ts`.

### Data Model Changes

None.

### API Changes

None.

### Key Implementation Details

#### 1. The eval-model helper

```typescript
// src/__tests__/evals/helpers/get_eval_model.ts
import {
  createDyadEngine,
  type DyadEngineProvider,
} from "@/ipc/utils/llm_engine_provider";
import type { LanguageModel } from "ai";
import type { UserSettings } from "@/lib/schemas";

export type EvalProvider = "anthropic" | "openai" | "google";

// Gateway prefixes must match CLOUD_PROVIDERS in language_model_constants.ts.
const GATEWAY_PREFIXES: Record<EvalProvider, string> = {
  openai: "",
  anthropic: "anthropic/",
  google: "gemini/",
};

export function hasDyadProKey(): boolean {
  return !!process.env.DYAD_PRO_API_KEY;
}

let _provider: DyadEngineProvider | null = null;

/**
 * Reassemble an SSE stream of OpenAI chat-completion chunks into a single
 * non-streaming JSON response that the AI SDK's `doGenerate` path can parse.
 *
 * The Dyad Engine only supports `stream: true`, but the AI SDK sends
 * non-streaming requests for `generateText`. This adapter bridges the gap.
 */
async function sseToNonStreamingResponse(
  response: Response,
): Promise<Response> {
  const text = await response.text();
  const lines = text.split("\n");

  let id = "";
  let model = "";
  const choices: Map<
    number,
    {
      role: string;
      content: string;
      tool_calls: Map<
        number,
        {
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }
      >;
      finish_reason: string | null;
    }
  > = new Map();

  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    let chunk: any;
    try {
      chunk = JSON.parse(line.slice(6));
    } catch {
      continue;
    }

    // Surface engine errors as JSON error responses for the SDK's retry logic.
    if (chunk.error) {
      return new Response(JSON.stringify(chunk), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (chunk.id) id = chunk.id;
    if (chunk.model) model = chunk.model;

    for (const c of chunk.choices ?? []) {
      const idx = c.index ?? 0;
      if (!choices.has(idx)) {
        choices.set(idx, {
          role: "assistant",
          content: "",
          tool_calls: new Map(),
          finish_reason: null,
        });
      }
      const choice = choices.get(idx)!;
      const delta = c.delta ?? {};
      if (delta.role) choice.role = delta.role;
      if (delta.content) choice.content += delta.content;
      if (c.finish_reason) choice.finish_reason = c.finish_reason;
      for (const tc of delta.tool_calls ?? []) {
        const tcIdx = tc.index ?? 0;
        if (!choice.tool_calls.has(tcIdx)) {
          choice.tool_calls.set(tcIdx, {
            id: tc.id ?? "",
            type: tc.type ?? "function",
            function: { name: "", arguments: "" },
          });
        }
        const existing = choice.tool_calls.get(tcIdx)!;
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments)
          existing.function.arguments += tc.function.arguments;
      }
    }
  }

  const assembled = {
    id,
    object: "chat.completion",
    model,
    choices: Array.from(choices.entries())
      .sort(([a], [b]) => a - b)
      .map(([idx, c]) => ({
        index: idx,
        message: {
          role: c.role,
          content: c.content || null,
          ...(c.tool_calls.size > 0
            ? {
                tool_calls: Array.from(c.tool_calls.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([, tc]) => tc),
              }
            : {}),
        },
        finish_reason: c.finish_reason ?? "stop",
      })),
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };

  return new Response(JSON.stringify(assembled), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Fetch wrapper that adapts requests for the Dyad Engine, which only supports
 * streaming. For non-streaming SDK calls (e.g. `generateText`), this forces
 * `stream: true` in the request and reassembles the SSE response into the
 * single JSON object the SDK expects.
 */
const evalFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      const wasNonStreaming = !parsed.stream;
      parsed.stream = true;
      init = { ...init, body: JSON.stringify(parsed) };
      const response = await fetch(input, init);
      if (wasNonStreaming) {
        return sseToNonStreamingResponse(response);
      }
      return response;
    } catch {
      return fetch(input, init);
    }
  }
  return fetch(input, init);
};

function getProvider(): DyadEngineProvider {
  if (!_provider) {
    _provider = createDyadEngine({
      apiKey: process.env.DYAD_PRO_API_KEY,
      baseURL: process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1",
      dyadOptions: {
        enableLazyEdits: false,
        enableSmartFilesContext: false,
        enableWebSearch: false,
      },
      // Minimal UserSettings — the engine only needs these for
      // getExtraProviderOptions, which is a no-op for our eval.
      settings: {} as UserSettings,
      fetch: evalFetch,
    });
  }
  return _provider;
}

export function getEvalModel(
  provider: EvalProvider,
  modelName: string,
): LanguageModel {
  const dyadProvider = getProvider();
  const modelId = `${GATEWAY_PREFIXES[provider]}${modelName}`;
  // Use the chat completions model for all providers. See the note above
  // "Why chat completions for all models" for the rationale.
  return dyadProvider(modelId, { providerId: provider });
}
```

**Dyad Engine streaming constraint.** The Dyad Engine (a litellm proxy) only supports `stream: true` for the `/chat/completions` endpoint — non-streaming requests return a generic 500. Since the AI SDK's `generateText` sends non-streaming requests (`stream` absent or `false`), the eval's `evalFetch` wrapper forces `stream: true` on every outgoing request and then reassembles the SSE chunks into a single JSON response via `sseToNonStreamingResponse`. This adapter handles content deltas, tool-call deltas (including streamed function arguments), and in-stream error events. It is transparent to the rest of the eval code — `generateText` works exactly as if the engine supported non-streaming requests.

#### 2. The eval suite (shape only)

The eval has two tiers of test cases, each with its own assertion strategy:

- **Exact-match cases** require exactly one `search_replace` call (no `execute`, tool call inspected directly). The eval asserts the call count is `=== 1` — over-editing (multiple calls) fails the case rather than silently passing on the first call. The edit is applied via `applySearchReplace` and the result is compared byte-for-byte against `expectedContent`. These are the deterministic regression backbone — fast, cheap, no LLM cost for verification.
- **Judge-verified cases** allow **multiple** `search_replace` calls via `stopWhen: stepCountIs(10)`, since complex edits (e.g. splitting a 700-line component into 3) naturally require several sequential operations. The tool is given an `execute` function that, for each call, asserts `args.file_path === c.fileName` (catching routing confusion) and runs `assertNotFullFileRewrite` against the running content (catching the cheat-via-total-replacement failure mode per-call, before the edit is applied). The edit is then applied to a running copy of the file and a confirmation message is returned. After all steps complete, the final file state is evaluated by a **judge model** (GPT 5.4 via the same Dyad Engine) that receives the original file, the prompt, and the result, and renders a PASS/FAIL verdict with explanation. Optional `structuralChecks` (simple string-contains assertions) run as a precondition before the judge, catching gross errors cheaply without an LLM call.

```typescript
// src/__tests__/evals/search_replace_tool_use.eval.ts
import { describe, it, expect } from "vitest";
import { generateText, stepCountIs } from "ai";
import { searchReplaceTool } from "@/pro/main/ipc/handlers/local_agent/tools/search_replace";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { escapeSearchReplaceMarkers } from "@/pro/shared/search_replace_markers";
import {
  SONNET_4_6,
  GPT_5_4,
  GEMINI_3_FLASH,
} from "@/ipc/shared/language_model_constants";
import {
  getEvalModel,
  hasDyadProKey,
  type EvalProvider,
} from "./helpers/get_eval_model";

// ── Case types ──────────────────────────────────────────────

interface BaseCase {
  name: string;
  fileName: string;
  fileContent: string;
  prompt: string;
}

interface ExactMatchCase extends BaseCase {
  kind: "exact";
  expectedContent: string;
}

interface JudgeVerifiedCase extends BaseCase {
  kind: "judge";
  /** Optional quick checks that run before the judge.
   *  Each string must appear in the output for the case to pass. */
  structuralChecks?: string[];
}

type EvalCase = ExactMatchCase | JudgeVerifiedCase;

// ── Cases ───────────────────────────────────────────────────
// File contents and expected outputs live in
// src/__tests__/evals/fixtures/search_replace/ as standalone
// files loaded via readFileSync.

const EXACT_CASES: ExactMatchCase[] = [
  /* ~7 cases — see list below */
];

const JUDGE_CASES: JudgeVerifiedCase[] = [
  /* ~5 cases — see list below */
];

const ALL_CASES: EvalCase[] = [...EXACT_CASES, ...JUDGE_CASES];

// ── Judge helper ────────────────────────────────────────────

async function judgeResult(
  originalFile: string,
  prompt: string,
  resultFile: string,
): Promise<{ pass: boolean; explanation: string }> {
  const result = await generateText({
    // GPT 5.4 via Dyad Engine — used as an independent judge so
    // it never evaluates its own output.
    model: getEvalModel("openai", GPT_5_4),
    temperature: 1, // required for GPT-5 family
    system:
      "You are a code-review judge. You will be given an original file, " +
      "an edit instruction, and the resulting file after the edit was applied. " +
      "Evaluate whether the result correctly implements the requested change " +
      "without introducing bugs, removing unrelated code, or breaking the " +
      "file's existing behavior.\n\n" +
      "Think step-by-step, then on the LAST line write exactly PASS or FAIL.",
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

  const text = result.text.trim();
  const lastLine = text.split("\n").at(-1)?.trim() ?? "";
  return {
    pass: lastLine === "PASS",
    explanation: text,
  };
}

// ── Shared apply helper ─────────────────────────────────────

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

// ── Full-file-rewrite guard ─────────────────────────────────
// If `old_string` covers more than 80% of the file, the model
// is effectively rewriting the whole file rather than making a
// surgical edit — this is the failure mode the eval is
// specifically designed to catch.
const MAX_OLD_STRING_RATIO = 0.8;

function assertNotFullFileRewrite(
  fileContent: string,
  oldString: string,
  context: string,
): void {
  const ratio = oldString.length / fileContent.length;
  expect(
    ratio,
    `${context}: old_string covers ${(ratio * 100).toFixed(1)}% of the file ` +
      `(max ${MAX_OLD_STRING_RATIO * 100}%) — looks like a full-file rewrite`,
  ).toBeLessThanOrEqual(MAX_OLD_STRING_RATIO);
}

// ── Model matrix ────────────────────────────────────────────

// Temperature per model must match language_model_constants.ts.
// GPT-5 and Gemini 3 reasoning models require temperature: 1;
// Anthropic models use temperature: 0.
const MODELS: Array<{
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

// ── Test runner ─────────────────────────────────────────────

for (const { provider, modelName, label, temperature } of MODELS) {
  describe.skipIf(!hasDyadProKey())(`search_replace eval — ${label}`, () => {
    for (const c of ALL_CASES) {
      it.concurrent(c.name, async () => {
        if (c.kind === "exact") {
          // ── Exact-match: single tool call, no execute ──
          const result = await generateText({
            model: getEvalModel(provider, modelName),
            temperature,
            system:
              "You are a precise code editor. When asked to change a file, " +
              "call the search_replace tool exactly once. Do not explain.",
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
                // No execute — tool call returned directly.
              },
            },
          });

          const calls = result.toolCalls.filter(
            (t) => t.toolName === "search_replace",
          );
          expect(
            calls.length,
            `${label} expected exactly 1 search_replace call, got ${calls.length}`,
          ).toBe(1);
          const call = calls[0];

          const args = call.input as {
            file_path: string;
            old_string: string;
            new_string: string;
          };

          expect(args.file_path, `${label} targeted wrong file`).toBe(c.fileName);
          assertNotFullFileRewrite(
            c.fileContent,
            args.old_string,
            `${label} / ${c.name}`,
          );
          const resultContent = applyEdit(c.fileContent, args);
          expect(resultContent.trim()).toBe(c.expectedContent.trim());
        } else {
          // ── Judge-verified: multiple calls allowed via stopWhen ──
          // Mutable state: each execute call updates the running file.
          let currentContent = c.fileContent;

          const result = await generateText({
            model: getEvalModel(provider, modelName),
            temperature,
            stopWhen: stepCountIs(10),
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
                  return "Edit applied successfully.";
                },
              },
            },
          });

          // Must have made at least one tool call.
          const totalCalls = result.steps.reduce(
            (n, s) => n + s.toolCalls.length,
            0,
          );
          expect(
            totalCalls,
            `${label} made no search_replace calls`,
          ).toBeGreaterThan(0);

          // Run structural checks, then the judge.
          for (const check of c.structuralChecks ?? []) {
            expect(
              currentContent,
              `Structural check failed: expected output to contain "${check}"`,
            ).toContain(check);
          }
          const verdict = await judgeResult(
            c.fileContent,
            c.prompt,
            currentContent,
          );
          expect(
            verdict.pass,
            `Judge (GPT 5.4) said FAIL for ${label}:\n${verdict.explanation}`,
          ).toBe(true);
        }
      });
    }
  });
}
```

Important details:

- **Two tool-call patterns.** Exact-match cases omit `execute` so the AI SDK surfaces tool calls directly in `result.toolCalls`, and the eval asserts exactly one `search_replace` call was emitted — over-editing fails the case rather than silently passing on the first call. Judge-verified cases provide an `execute` function and set `stopWhen: stepCountIs(10)`, allowing the model to make multiple sequential edits (e.g. extracting three components from a large file). The `execute` function applies each edit to a running `currentContent` variable and returns a confirmation string, so the model sees the result of each step.
- **Judge independence.** The judge is always GPT 5.4 regardless of which model is being evaluated. When evaluating GPT 5.4 itself, the judge is still GPT 5.4 — this is a known limitation but acceptable for v1 because (a) the judge task (verifying an edit) is much simpler than the generation task (producing the edit), and (b) the structural checks catch the most obvious failures before the judge runs. If this becomes a concern, a follow-up can rotate judges so no model evaluates its own output.

#### 3. Vitest config

```typescript
// vitest.eval.config.ts
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/evals/**/*.eval.ts"],
    globals: true,
    testTimeout: 120_000, // LLM calls can be slow; judge-verified cases make multiple calls
    maxConcurrency: 5, // parallelize across cases; keeps Dyad Engine rate-limit safe
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
```

#### 4. `package.json` script

Add next to the existing `test` script:

```jsonc
"eval": "cross-env NODE_OPTIONS=--no-deprecation vitest run --config vitest.eval.config.ts",
```

## Implementation Plan

### Phase 1: Harness

- [ ] Add `export const GPT_5_4 = "gpt-5.4"` to `src/ipc/shared/language_model_constants.ts` (alongside the existing `SONNET_4_6`, `GEMINI_3_FLASH`, etc.). Add a corresponding entry in the `openai` section of `MODEL_OPTIONS` with `temperature: 1` and appropriate display metadata.
- [ ] Create `vitest.eval.config.ts` with the config shown above.
- [ ] Create `src/__tests__/evals/helpers/get_eval_model.ts` implementing `EvalProvider`, `hasDyadProKey`, and `getEvalModel`. Use `createDyadEngine` from `llm_engine_provider.ts` with gateway prefixes matching `CLOUD_PROVIDERS`. All models use the chat completions path (`provider()`, not `.responses()`). Include the `evalFetch` wrapper with `sseToNonStreamingResponse` to bridge the Dyad Engine's streaming-only constraint.
- [ ] Add `"eval"` script to `package.json`.
- [ ] Verify the harness by running `npm run eval` with no test file — expect an empty pass.

### Phase 2: Eval Cases

- [ ] Create `src/__tests__/evals/search_replace_tool_use.eval.ts`.
- [ ] Write fixture files in `src/__tests__/evals/fixtures/search_replace/`, loaded via `readFileSync`. Each fixture is a standalone source file (50–700 lines) that looks like real production code.
- [ ] Implement the `judgeResult` helper and the two-tier assertion logic (`exact` vs `judge`).
- [ ] Write **~7 exact-match cases** (`ExactMatchCase`). Each has a single correct `expectedContent`. These are small, unambiguous, surgical edits:
  1. **Template literal conversion** — convert string concatenation to a template literal in `greet.ts` (~60 lines), leaving the rest of the module untouched.
  2. **Rename local variable without touching same name elsewhere** — rename `result` → `weightedSum` inside `weightedAverage` in `stats.ts` (~80 lines), without affecting a different `result` in another function.
  3. **Add error logging before an existing return** — insert a `logger.error(...)` call before a `return null` in `api/client.ts` (~100 lines).
  4. **Change a condition** — add `"delete"` to a permissions array in `permissions.ts` (~90 lines).
  5. **Swap an import path** — change `../../utils/old_helpers` → `@/utils/helpers` in `Dashboard.tsx` (~120 lines) which has many imports.
  6. **Fix an off-by-one bug** — change `i <= arr.length` to `i < arr.length` in a loop inside a 100-line utility file with multiple similar loops.
  7. **Toggle a boolean default** — change `enabled: false` → `enabled: true` in a config object buried in a 150-line settings file with several similar-looking objects.
- [ ] Write **~5 judge-verified cases** (`JudgeVerifiedCase`). These are complex edits where multiple valid outputs exist. Each includes `structuralChecks` (strings that must appear in the output) as a cheap precondition before the judge runs:
  1. **Extract a helper function** (~200-line file) — "Extract the validation logic in `processOrder` (the block that checks inventory, validates payment, and verifies shipping) into a separate `validateOrder` function." `structuralChecks: ["function validateOrder", "validateOrder("]`.
  2. **Add error handling to multiple call sites** (~250-line file) — "Wrap each `fetch()` call in `api_client.ts` with try/catch that logs the URL and re-throws." Multiple valid orderings of the catch block contents. `structuralChecks: ["try {", "catch"]`.
  3. **Convert a class component to a function component** (~300-line React file) — "Convert `UserProfile` from a class component to a function component using hooks." `structuralChecks: ["function UserProfile", "useState", "useEffect"]`.
  4. **Refactor a giant component into 3 smaller ones** (~700-line React file) — "Extract `AvatarSection` (the avatar/upload logic around lines 100-200), `StatsPanel` (the stats grid around lines 280-420), and `ActivityFeed` (the activity list around lines 480-620) into their own components in the same file, then use them in the main `UserProfile` component." `structuralChecks: ["function AvatarSection", "function StatsPanel", "function ActivityFeed", "<AvatarSection", "<StatsPanel", "<ActivityFeed"]`.
  5. **Reorganize a switch statement into a strategy map** (~200-line file) — "Refactor the `handleEvent` switch statement into a `Record<EventType, handler>` map and a dispatch function." `structuralChecks: ["Record<", "handleEvent"]`.
- [ ] Implement the `assertNotFullFileRewrite` helper with `MAX_OLD_STRING_RATIO = 0.8` (definition shown in the "Full-file-rewrite guard" section of the eval suite code). Call it from both the exact-match branch and the judge-mode `execute` function so every individual `search_replace` call is checked per-call, before its edit is applied.
- [ ] Wire up the model matrix with `SONNET_4_6`, `GPT_5_4`, and `GEMINI_3_FLASH` — all imported from `language_model_constants.ts`. The judge also uses `GPT_5_4` via the same import.
- [ ] Confirm `describe.skipIf` correctly skips when `DYAD_PRO_API_KEY` is absent (run with no key set → all suites should be SKIPPED, not FAILED).

### Phase 3: Run & Tune

- [ ] Run `DYAD_PRO_API_KEY=... npm run eval`.
- [ ] Investigate any failures. Common failure modes:
  - Model produces `old_string` with slightly different whitespace — `applySearchReplace` has fuzzy whitespace matching (see `search_replace.spec.ts:236-263`), which should handle this, but confirm.
  - Model produces multi-step plan instead of a single tool call. Tighten the system prompt to require exactly one call.
  - Model rewrites the entire file by putting all (or most) of the file content into `old_string`. The `MAX_OLD_STRING_RATIO` guard in the eval catches this — if triggered, tighten the system prompt or tool description to discourage full-file rewrites.
  - Judge says FAIL but the output looks correct. Tighten the judge prompt or adjust the `structuralChecks` so the judge has better grounding. If the judge is consistently wrong on a case, consider whether the case should be exact-match instead.
  - Judge says PASS but the output is subtly wrong. Add more `structuralChecks` to catch the pattern, or make the judge prompt more specific about what to look for in that case.
- [ ] For exact-match cases: commit once all three models consistently pass at their production temperatures.
- [ ] For judge-verified cases: run each case 3 times per model. A case passes if it passes all 3 runs. Investigate any case that is flaky across runs — this usually means the prompt is under-specified or the structural checks are too loose.

### Phase 4: Toward Replacing `edit_file` With `search_replace` (Aspirational)

**This phase is an eventual ideal, not an immediate objective.** Having `search_replace` become the primary edit tool is a long-term goal; the eval harness from Phases 1–3 is the prerequisite for pursuing it confidently, since it lets us A/B reliability strategies and measure each model's pass rate before flipping any defaults. Nothing below ships in the current PR — it's documented here so the eval harness is designed with these future experiments in mind.

#### Reliability strategies to evaluate

Each of these is a well-known technique from other tool-using agent systems (Claude Code's `Edit` tool, Aider's editblock format, Cline, etc.). The eval harness makes them empirically testable: change one variable, re-run the eval, compare pass rates across models.

1. **Line-numbered file context.** When the model is shown a file (via `read_file` or inlined into the prompt), prefix every line with its 1-indexed number, e.g. `  42→  const sum = x + y;` — the format Claude Code's `Read` tool uses. Models that have been trained on this format become noticeably more precise about pointing at specific regions and are less inclined to regenerate the whole file because "there's no way to point at just those lines." The tool description must explicitly tell the model to strip the `N→` prefix from its `old_string`.

2. **Force a fresh read before edit.** Claude Code's `Edit` tool refuses to run unless the file has been `Read` in the current session. Porting this rule to `search_replace` eliminates the class of failures where the model edits a cached or hallucinated version of the file.

3. **Show nearby candidates on failure.** When `applySearchReplace` can't find `old_string`, today it returns a generic error. Instead, return the closest matching region from the file along with a unified diff between the provided `old_string` and that region. This gives the model enough feedback to self-correct on the next turn instead of retrying blindly or falling back to rewriting the file.

4. **Reject full-file rewrites at the tool level.** The most common failure mode is the model sneaking a whole-file replacement through `search_replace` by putting the entire file in `old_string`. Add a heuristic: if `old_string` covers more than some fraction of the file (e.g. 80%) or more than some absolute line count (e.g. 50), reject with a message pointing the model toward multiple smaller calls. This is a hard guardrail that the eval can directly measure against an adversarial "rewrite the file" case.

5. **Normalize CRLF/LF and trailing whitespace.** `applySearchReplace` already has fuzzy whitespace matching (`search_replace.spec.ts:236-263`); extend it to also normalize line endings and trim trailing whitespace before comparison. Reduces failures on Windows-origin files and copy-paste artifacts.

6. **Iterate on `searchReplaceTool.description`.** The prompt attached to the tool is the single highest-leverage knob, and the eval harness makes prompt changes A/B-testable. Expect most correctness gains to come from description tweaks — particularly tightening the "when NOT to use this tool" guidance to close the entire-file-rewrite escape hatch.

#### Code changes required

Roughly in order of smallest-to-largest:

- **`searchReplaceTool.description`** (`tools/search_replace.ts:44-62`) — iterate on wording. No structural code change.
- **`applySearchReplace`** (`processors/search_replace_processor.ts`) — extend to normalize line endings, return a "nearest match" struct on failure, and add the full-file-rewrite heuristic.
- **`searchReplaceTool.execute`** (`tools/search_replace.ts:92-159`) — on failure, format the nearest-match struct from the processor into an error message the model can act on.
- **`read_file.ts`** (`tools/read_file.ts:82-112`) — add a code path that prefixes each returned line with `<1-indexed-number>→`. Keep a raw-content path available so non-agent callers are unaffected.
- **Per-model tool gating.** `buildAgentToolSet` already filters by `isEnabled(ctx)` (`tool_definitions.ts:448`), so gating is a natural extension. Introduce a small map keyed on `(provider, modelName)` and wire `isEnabled` on both tools to consult it. Models not in the map keep the current default (`edit_file`).

  ```typescript
  // edit_tool_preferences.ts (new)
  export type EditToolPreference = "search_replace" | "edit_file" | "both";
  const PREFERRED_EDIT_TOOL_BY_MODEL: Record<string, EditToolPreference> = {
    // populated as eval numbers justify migration, e.g.
    // "anthropic/claude-sonnet-4-6": "search_replace",
  };
  export function getPreferredEditTool(ctx: AgentContext): EditToolPreference {
    return (
      PREFERRED_EDIT_TOOL_BY_MODEL[`${ctx.provider}/${ctx.modelId}`] ??
      "edit_file"
    );
  }

  // search_replace.ts
  searchReplaceTool.isEnabled = (ctx) =>
    getPreferredEditTool(ctx) !== "edit_file";

  // edit_file.ts
  editFileTool.isEnabled = (ctx) =>
    getPreferredEditTool(ctx) !== "search_replace";
  ```

- **`AgentContext`** (`tools/types.ts`) — add `modelId` / `provider` fields if not already present, so `isEnabled` callbacks can consult them.
- **`edit_file` retirement** (terminal state) — once every in-catalog model is on `search_replace`, delete `edit_file.ts`, its processor, and associated telemetry/system-prompt references. Expect to sit in dual-tool mode for a long time first.

### Phase 5 (follow-up, not in this PR)

- [ ] Extend the harness to `edit_file` and `write_file` (prerequisite for Phase 4 step 2).
- [ ] Add a nightly GitHub Actions workflow that injects `DYAD_PRO_API_KEY` from secrets and runs `npm run eval`.
- [ ] Add eval-result archival so regressions over time are visible.

## Testing Strategy

This plan **is** a testing plan — the eval is itself the test. Meta-validation:

- [ ] Unit-level: run `npm run eval` with `DYAD_PRO_API_KEY` unset. All suites must be SKIPPED, no failures.
- [ ] With key set: exact-match cases must pass deterministically across 3 consecutive runs for all three target models. Judge-verified cases must pass all 3 runs per model (judge flakiness is a signal to tighten structural checks or the judge prompt).
- [ ] Confirm the eval does NOT run during `npm test` (different `include` pattern).
- [ ] Confirm the eval file is caught by `npm run lint` / `npm run fmt:check` (it lives under `src/` so it's in scope).

## Risks & Mitigations

| Risk                                                              | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider model IDs change (e.g., `gpt-5.4` renamed)               | Medium     | Low    | All model names (including the judge) are imported from `language_model_constants.ts`, so renames propagate automatically.                                                                                                                          |
| Non-determinism (especially at `temperature: 1` for GPT-5/Gemini) | Medium     | Medium | Exact-match cases use small, unambiguous edits. Judge-verified cases tolerate variance by design — the judge evaluates semantic correctness, not byte-equality.                                                                                    |
| Judge too lenient (rubber-stamps bad output)                      | Medium     | Medium | `structuralChecks` run before the judge as a cheap precondition. The judge prompt requires step-by-step reasoning before the verdict, reducing snap approvals. If a pattern emerges, add more structural checks or convert to exact-match.         |
| Judge too strict (rejects valid output)                           | Low        | Low    | Judge failures include the full explanation in the test error. Easy to diagnose and fix by adjusting the judge prompt or the case's structural checks.                                                                                             |
| GPT 5.4 judging its own output                                    | Low        | Low    | Only affects GPT 5.4 eval runs. The judge task (verify an edit) is much simpler than the generation task (produce it). Can rotate judges in a follow-up if needed.                                                                                 |
| API cost creep from judge calls                                   | Medium     | Low    | Judge calls only run for ~5 judge-verified cases × 3 models = ~15 extra LLM calls per eval run. Structural checks fail fast and skip the judge when possible. All calls route through the Dyad Engine on a single key, so cost is easy to monitor. |
| AI SDK v5 tool shape drifts                                       | Low        | Medium | Harness mirrors `buildAgentToolSet` exactly — if the production shape changes, the eval will surface the mismatch.                                                                                                                                 |
| Test runs leak Dyad Pro key into logs                             | Low        | High   | `getEvalModel` reads the key from `process.env` only; no logging of key values. Vitest does not print env to test output by default.                                                                                                               |
| `applySearchReplace` fuzzy matching masks real model failures     | Low        | Medium | Eval asserts on _final file content_, not on `old_string` being byte-identical, so fuzzy matching is actually desired here — it matches production behavior.                                                                                       |

## Open Questions

- **Should cases include multi-file / multi-edit scenarios?** Those depend on `search_replace` being called multiple times in sequence, which requires re-feeding the edited file into the next turn. Out of scope for v1; a good Phase 4 addition.
- **Gemini 3 Flash is marked Preview in the constants file.** If it's unstable for tool-calling at eval time, fall back to `gemini-flash-latest` (also in the constants file) — it's functionally equivalent for this eval.

## Decision Log

| Decision                                                                         | Reasoning                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New directory `src/__tests__/evals/`                                             | Evals and unit tests have fundamentally different runtime characteristics (network calls, API keys, slow, non-deterministic) and must not share a runner. A dedicated directory + `.eval.ts` suffix makes this separation obvious at a glance.       |
| Separate `vitest.eval.config.ts` + `npm run eval`                                | Prevents evals from running in `npm test` / CI. An opt-in runner is the standard way to keep network-dependent, key-gated tests out of the default developer loop.                                                                                   |
| Use `createDyadEngine` directly, bypass `getModelClient` and `buildAgentToolSet` | `getModelClient` carries Electron/DB/settings coupling. `createDyadEngine` is the pure factory underneath it — calling it directly with just an API key and base URL gives us the same Dyad Engine routing production uses, with zero Electron deps. |
| Reuse `searchReplaceTool.inputSchema` + `.description` + `applySearchReplace`    | These are the only pieces whose exact identity matters for eval fidelity — they are what production LLMs see and what processes their output.                                                                                                        |
| No `execute` in the tool definition passed to `generateText`                     | Standard AI SDK pattern for inspecting a tool call without executing it. Removes need for file I/O, temp dirs, or cleanup.                                                                                                                           |
| Two-tier cases: exact-match + judge-verified                                     | Exact-match cases are the deterministic regression backbone (cheap, fast, no LLM verification cost). Judge-verified cases unlock complex refactors where multiple valid outputs exist — without them, the eval can only test trivial edits.          |
| GPT 5.4 as judge model                                                           | Strong reasoning model available through the same Dyad Engine. Using a single fixed judge (rather than rotating) keeps the eval simple and the verdicts comparable across runs. Self-judging for GPT 5.4 runs is an accepted v1 trade-off.           |
| `structuralChecks` as precondition before judge                                  | Cheap string-contains assertions catch gross failures (missing function name, missing import) without an LLM call. Reduces judge cost and gives faster, more debuggable feedback when the output is clearly wrong.                                   |
| Assert on final file content, not on raw `old_string`/`new_string`               | Semantic check is more robust to phrasing variance and exercises the production processor end-to-end.                                                                                                                                                |
| Per-model temperature from `language_model_constants.ts`                         | GPT-5 and Gemini 3 reasoning models reject or require `temperature: 1`; Anthropic models use `0`. Using each model's production temperature avoids API errors and matches real behavior.                                                             |
| Single model per provider (not a full matrix)                                    | Balances signal vs. cost/runtime. Easy to extend later.                                                                                                                                                                                              |
| `describe.skipIf(!hasDyadProKey())` (not `it.skipIf`)                            | Skipping at the describe level is clearer in output: when `DYAD_PRO_API_KEY` is absent, the entire suite is reported as skipped rather than one skip per case.                                                                                       |

---

_Generated 2026-04-04_
