# LLM Eval: `search_replace` Tool Use

## Summary

Add a new **evals** test suite that verifies real LLMs (Claude Sonnet 4.6, GPT-5, Gemini 3 Flash) can correctly invoke the `search_replace` tool when given a source file and a natural-language edit instruction. The eval runs against the providers' real APIs, reuses the production `searchReplaceTool` definition (schema + description) and the `applySearchReplace` processor, and is isolated behind a new `npm run eval` script so it never runs as part of normal CI.

## Problem Statement

`search_replace` is intended to eventually become the primary file-editing tool for Dyad's local agent, but today LLMs frequently fail to use it correctly. Because of this, Dyad currently leans on `edit_file` as the workhorse — and until we can measure `search_replace` tool-call correctness across models, we have no principled way to know when (or whether) it's ready to take over.

The existing unit tests (`search_replace.spec.ts`) only exercise the tool's `execute` path against mocked file contents; they tell us nothing about whether any real model can _decide_ to use the tool and _emit the right arguments_ when it does. This plan adds that missing signal.

We need a lightweight eval harness that:

1. Sends a real prompt + file snippet to each target model.
2. Captures the `search_replace` tool call the model produces.
3. Applies that tool call via the real `applySearchReplace` processor.
4. Asserts that the resulting file matches an expected edited version.

## Scope

### In Scope

- New directory `src/__tests__/evals/` with a small reusable helper for instantiating LLM clients from env-var API keys.
- New eval file `src/__tests__/evals/search_replace_tool_use.eval.ts` containing 3–5 representative edit cases.
- Target models: **`claude-sonnet-4-6`** (Anthropic), **`gpt-5`** (OpenAI, responses API), **`gemini-3-flash-preview`** (Google). Model names come from `src/ipc/shared/language_model_constants.ts` so the eval drifts with Dyad's canonical model identifiers.
- Separate `vitest.eval.config.ts` with `environment: "node"`, long `testTimeout`, and an `include` pattern of `src/__tests__/evals/**/*.eval.ts`.
- New `npm run eval` script — the eval is **not** included in `npm test`.
- `describe.skipIf(!hasApiKey(provider))` gating so each provider's block is silently skipped when its env var is missing (safe in CI).
- Reuse of `searchReplaceTool.inputSchema` and `searchReplaceTool.description` — the LLM sees the exact same tool contract it sees in production.
- Reuse of `applySearchReplace` from `src/pro/main/ipc/processors/search_replace_processor.ts` for semantic assertion — the eval verifies that the edit _actually produces the right file_, not just that the args look plausible.

### Out of Scope

- Running the eval in CI. This is a local-only / on-demand quality gate. A follow-up can add a nightly workflow that sets the API keys from GitHub secrets.
- Testing every model in Dyad's catalog. We test one representative model per major provider.
- Testing other file-edit tools (`edit_file`, `write_file`). The same harness can be extended to them in a follow-up.
- A scoring / regression-tracking dashboard. Pass/fail is sufficient for v1.
- Exercising the full local-agent handler (`local_agent_handler.ts`) — we bypass it entirely and call `generateText` directly because the handler is coupled to Electron, the DB, settings, IPC, consent dialogs, and streaming XML rendering. See "Why not reuse `buildAgentToolSet` / `local_agent_handler`?" below.

## Technical Design

### Architecture

A single eval file drives a matrix of **(model × test case)**. For each combination:

1. Instantiate a raw AI SDK `LanguageModel` via a thin helper.
2. Call `generateText` with:
   - The eval's file content embedded in the user message.
   - A minimal system prompt instructing the model to emit a `search_replace` tool call.
   - A **single tool** — `search_replace` — wrapped to match the AI SDK v5 shape used by `buildAgentToolSet` (`{ description, inputSchema }`). Crucially, we do **not** provide an `execute` function: without one, the AI SDK stops after the tool call and returns the arguments to us, which is exactly what we want to inspect.
3. Extract the tool call from `result.toolCalls`.
4. Apply it via `applySearchReplace` against the original file content.
5. Assert that the resulting content equals the eval case's `expectedContent`.

This mirrors, at the protocol level, what `buildAgentToolSet` does in production — we use the **same schema**, the **same description**, and the **same processor** — but sidesteps the Electron / IPC / DB machinery.

### Why not reuse `buildAgentToolSet` / `getModelClient` / `local_agent_handler`?

Each of these was considered and rejected for specific reasons:

- **`local_agent_handler.ts`** is a 1,600-line orchestrator tightly coupled to Electron IPC events, the SQLite chat DB, consent callbacks, XML streaming, telemetry, and file-edit tracking. Running it in a unit test requires dozens of mocks (see `src/__tests__/local_agent_handler.test.ts`) and still only exercises a fake stream. Using it for an eval would add enormous complexity for no signal gain.
- **`buildAgentToolSet`** (`tool_definitions.ts:412`) requires an `AgentContext` with `event`, `appPath`, `requireConsent`, `onXmlStream`, etc. We do not want consent dialogs, file writes, or XML streaming during an eval. Instead we inline the ~3 lines `buildAgentToolSet` uses to wrap a `ToolDefinition` for the AI SDK (`{ description: tool.description, inputSchema: tool.inputSchema }`), which is the part worth reusing.
- **`getModelClient`** (`get_model_client.ts`) is the most tempting reuse target, but it pulls in `electron-log`, `getLanguageModelProviders` (hits the settings DB), the Dyad Pro engine wrapper, Vertex service-account JSON handling, Ollama URL resolution, and a `UserSettings` object. For a standalone Node process this is all dead weight. Its core logic — pick a provider package and call it with an API key — is 5 lines per provider and is what our helper replicates.

**What _is_ reused from Dyad:**

- `searchReplaceTool.inputSchema` — zod schema identical to production.
- `searchReplaceTool.description` — LLM sees the exact same instructions.
- `applySearchReplace` — same processor that runs in production.
- Model IDs (`SONNET_4_6`, GPT-5, `GEMINI_3_FLASH`) imported from `language_model_constants.ts` so they can't drift.
- Env var names (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) that match `PROVIDER_TO_ENV_VAR` in `language_model_constants.ts`.
- AI SDK provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) that are already Dyad dependencies — we use them the same way `get_model_client.ts` does, including OpenAI's `.responses()` API for GPT-5 (which is what `getModelClient` uses for `selectedChatMode === "local-agent"` + `provider === "openai"` at `get_model_client.ts:256`).

### Components Affected

- **New file:** `vitest.eval.config.ts` — separate vitest config.
- **New file:** `src/__tests__/evals/helpers/get_eval_model.ts` — thin provider-to-client helper.
- **New file:** `src/__tests__/evals/search_replace_tool_use.eval.ts` — the eval suite itself.
- **Modified:** `package.json` — add an `eval` script.
- **No changes to:** production code in `src/pro/main/ipc/handlers/local_agent/` or `src/ipc/utils/get_model_client.ts`.

### Data Model Changes

None.

### API Changes

None.

### Key Implementation Details

#### 1. The eval-model helper

```typescript
// src/__tests__/evals/helpers/get_eval_model.ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI as createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type EvalProvider = "anthropic" | "openai" | "google";

const ENV_VARS: Record<EvalProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY", // matches PROVIDER_TO_ENV_VAR in language_model_constants.ts
};

export function hasApiKey(provider: EvalProvider): boolean {
  return !!process.env[ENV_VARS[provider]];
}

export function getEvalModel(
  provider: EvalProvider,
  modelName: string,
): LanguageModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
        modelName,
      );
    case "openai":
      // Matches getModelClient's behavior for local-agent + openai:
      // use the responses API so GPT-5 gets full tool-call functionality.
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses(
        modelName,
      );
    case "google":
      return createGoogle({ apiKey: process.env.GEMINI_API_KEY })(modelName);
  }
}
```

#### 2. The eval suite (shape only)

```typescript
// src/__tests__/evals/search_replace_tool_use.eval.ts
import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import { searchReplaceTool } from "@/pro/main/ipc/handlers/local_agent/tools/search_replace";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { escapeSearchReplaceMarkers } from "@/pro/shared/search_replace_markers";
import {
  SONNET_4_6,
  GEMINI_3_FLASH,
} from "@/ipc/shared/language_model_constants";
import {
  getEvalModel,
  hasApiKey,
  type EvalProvider,
} from "./helpers/get_eval_model";

interface EvalCase {
  name: string;
  fileName: string;
  fileContent: string;
  prompt: string;
  expectedContent: string;
}

const CASES: EvalCase[] = [
  /* 3–5 cases: template literal, rename local var, add console.log,
     change import, flip a condition, etc. Each has a deterministic
     expectedContent string. */
];

const MODELS: Array<{
  provider: EvalProvider;
  modelName: string;
  label: string;
}> = [
  { provider: "anthropic", modelName: SONNET_4_6, label: "Claude Sonnet 4.6" },
  { provider: "openai", modelName: "gpt-5", label: "GPT-5" },
  { provider: "google", modelName: GEMINI_3_FLASH, label: "Gemini 3 Flash" },
];

for (const { provider, modelName, label } of MODELS) {
  describe.skipIf(!hasApiKey(provider))(
    `search_replace eval — ${label}`,
    () => {
      for (const c of CASES) {
        it(c.name, async () => {
          const result = await generateText({
            model: getEvalModel(provider, modelName),
            temperature: 0,
            system:
              "You are a precise code editor. When asked to change a file, " +
              "you MUST call the search_replace tool exactly once. Do not explain.",
            messages: [
              {
                role: "user",
                content: `File: ${c.fileName}\n\`\`\`\n${c.fileContent}\n\`\`\`\n\n${c.prompt}`,
              },
            ],
            tools: {
              // Shape matches buildAgentToolSet: { description, inputSchema }.
              // No execute — we want the tool call returned to us.
              search_replace: {
                description: searchReplaceTool.description,
                inputSchema: searchReplaceTool.inputSchema,
              },
            },
          });

          const call = result.toolCalls.find(
            (t) => t.toolName === "search_replace",
          );
          expect(call, `${label} did not call search_replace`).toBeDefined();

          const args = call!.input as {
            file_path: string;
            old_string: string;
            new_string: string;
          };
          expect(args.file_path).toBe(c.fileName);

          // Reuse the production processor to apply the edit.
          // Escape marker-like sequences in the args, matching production behavior
          // in search_replace.ts:execute, so the parser doesn't misinterpret them.
          const escapedOld = escapeSearchReplaceMarkers(args.old_string);
          const escapedNew = escapeSearchReplaceMarkers(args.new_string);
          const ops = `<<<<<<< SEARCH\n${escapedOld}\n=======\n${escapedNew}\n>>>>>>> REPLACE`;
          const applied = applySearchReplace(c.fileContent, ops);
          expect(applied.success).toBe(true);
          expect(applied.content?.trim()).toBe(c.expectedContent.trim());
        });
      }
    },
  );
}
```

Two important details in the snippet above:

- **AI SDK v5 tool shape.** The AI SDK version in `package.json` (`@ai-sdk/anthropic ^3`, `@ai-sdk/openai ^3`, `ai` v5) uses `inputSchema` (not `parameters`), and tool calls expose their validated arguments on `.input` (not `.args`). This matches `buildAgentToolSet` at `tool_definitions.ts:452-454`.
- **No `execute`.** Omitting `execute` makes the AI SDK surface the tool call directly in `result.toolCalls` and stop. This is the standard "single-turn tool-call inspection" pattern and removes the need for `maxSteps` / step-control config.

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
    testTimeout: 60_000, // LLM calls can be slow
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

- [ ] Create `vitest.eval.config.ts` with the config shown above.
- [ ] Create `src/__tests__/evals/helpers/get_eval_model.ts` implementing `EvalProvider`, `hasApiKey`, and `getEvalModel`. Mirror the provider instantiation in `get_model_client.ts` (note `.responses()` for OpenAI).
- [ ] Add `"eval"` script to `package.json`.
- [ ] Verify the harness by running `npm run eval` with no test file — expect an empty pass.

### Phase 2: Eval Cases

- [ ] Create `src/__tests__/evals/search_replace_tool_use.eval.ts`.
- [ ] Write 3–5 `EvalCase` entries. Each must have an `expectedContent` string that is the one-and-only correct edit. File contents and expected outputs live in `src/__tests__/evals/fixtures/search_replace/` as standalone files loaded via `readFileSync`, keeping the eval file focused on case metadata and test logic. Example cases:
  1. **Template literal conversion in a larger module** — convert string concatenation to a template literal in `greet.ts`, leaving the rest of the module untouched.
  2. **Rename local variable without touching same name elsewhere** — rename `result` → `weightedSum` inside `weightedAverage` in `stats.ts`, without affecting other functions.
  3. **Add error logging before an existing return** — insert a `logger.error(...)` call before a return in `api/client.ts`.
  4. **Change a condition in one branch of a complex function** — add `"delete"` to a permissions array in `permissions.ts`.
  5. **Swap an import in a file with many imports** — change an import path in `Dashboard.tsx`.
- [ ] Add a `MAX_OLD_STRING_RATIO` guard (e.g. 0.8) that fails the test if `old_string` covers more than 80% of the file — this catches full-file rewrites at the eval level.
- [ ] Wire up the model matrix with `SONNET_4_6`, `"gpt-5"`, `GEMINI_3_FLASH` imported from `language_model_constants.ts` where available.
- [ ] Confirm `describe.skipIf` correctly skips when env vars are absent (run with no keys set → all suites should be SKIPPED, not FAILED).

### Phase 3: Run & Tune

- [ ] Run `ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... npm run eval`.
- [ ] Investigate any failures. Common failure modes:
  - Model produces `old_string` with slightly different whitespace — `applySearchReplace` has fuzzy whitespace matching (see `search_replace.spec.ts:236-263`), which should handle this, but confirm.
  - Model picks a different-but-also-valid edit. If this happens, either tighten the prompt or relax the assertion to a semantic check.
  - Model produces multi-step plan instead of a single tool call. Tighten the system prompt to require exactly one call.
  - Model rewrites the entire file by putting all (or most) of the file content into `old_string`. The `MAX_OLD_STRING_RATIO` guard in the eval catches this — if triggered, tighten the system prompt or tool description to discourage full-file rewrites.
- [ ] Commit once all three models pass all cases deterministically at `temperature: 0`.

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
- [ ] Add a nightly GitHub Actions workflow that injects API keys from secrets and runs `npm run eval`.
- [ ] Add eval-result archival so regressions over time are visible.

## Testing Strategy

This plan **is** a testing plan — the eval is itself the test. Meta-validation:

- [ ] Unit-level: run `npm run eval` with no API keys set. All suites must be SKIPPED, no failures.
- [ ] With keys set: all cases must pass at `temperature: 0` for all three target models, deterministically, across 3 consecutive runs.
- [ ] Confirm the eval does NOT run during `npm test` (different `include` pattern).
- [ ] Confirm the eval file is caught by `npm run lint` / `npm run fmt:check` (it lives under `src/` so it's in scope).

## Risks & Mitigations

| Risk                                                          | Likelihood | Impact | Mitigation                                                                                                                                                   |
| ------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider model IDs change (e.g., `gpt-5` renamed)             | Medium     | Low    | Model names are imported from `language_model_constants.ts` where available, so renames propagate.                                                           |
| Non-determinism even at `temperature: 0`                      | Medium     | Medium | Start with small, unambiguous edits; if flaky, widen assertion from exact-equals to semantic equivalence (AST or normalized-whitespace compare).             |
| API cost creep as eval grows                                  | Low        | Low    | Eval is opt-in (`npm run eval`), not part of CI. Keep case count small. Use the cheapest model in each family.                                               |
| AI SDK v5 tool shape drifts                                   | Low        | Medium | Harness mirrors `buildAgentToolSet` exactly — if the production shape changes, the eval will surface the mismatch.                                           |
| Test runs leak API keys into logs                             | Low        | High   | `getEvalModel` reads keys from `process.env` only; no logging of key values. Vitest does not print env to test output by default.                            |
| `applySearchReplace` fuzzy matching masks real model failures | Low        | Medium | Eval asserts on _final file content_, not on `old_string` being byte-identical, so fuzzy matching is actually desired here — it matches production behavior. |

## Open Questions

- **Should we also exercise the Dyad Pro engine path (`createDyadEngine`) as a fourth provider?** This would test the production-actual call route. Requires a Dyad Pro API key and the engine URL. Defer to a follow-up unless we already have CI access.
- **Should cases include multi-file / multi-edit scenarios?** Those depend on `search_replace` being called multiple times in sequence, which requires re-feeding the edited file into the next turn. Out of scope for v1; a good Phase 4 addition.
- **Gemini 3 Flash is marked Preview in the constants file.** If it's unstable for tool-calling at eval time, fall back to `gemini-flash-latest` (also in the constants file) — it's functionally equivalent for this eval.

## Decision Log

| Decision                                                                      | Reasoning                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New directory `src/__tests__/evals/`                                          | Evals and unit tests have fundamentally different runtime characteristics (network calls, API keys, slow, non-deterministic) and must not share a runner. A dedicated directory + `.eval.ts` suffix makes this separation obvious at a glance. |
| Separate `vitest.eval.config.ts` + `npm run eval`                             | Prevents evals from running in `npm test` / CI. An opt-in runner is the standard way to keep network-dependent, key-gated tests out of the default developer loop.                                                                             |
| Bypass `getModelClient` and `buildAgentToolSet`                               | Both carry heavy Electron/DB/IPC/settings coupling. Eval only needs the 5-line core of each. See "Why not reuse..." section.                                                                                                                   |
| Reuse `searchReplaceTool.inputSchema` + `.description` + `applySearchReplace` | These are the only pieces whose exact identity matters for eval fidelity — they are what production LLMs see and what processes their output.                                                                                                  |
| No `execute` in the tool definition passed to `generateText`                  | Standard AI SDK pattern for inspecting a tool call without executing it. Removes need for file I/O, temp dirs, or cleanup.                                                                                                                     |
| Assert on final file content, not on raw `old_string`/`new_string`            | Semantic check is more robust to phrasing variance and exercises the production processor end-to-end.                                                                                                                                          |
| `temperature: 0`                                                              | Maximizes determinism. Required for the eval to be a useful regression signal.                                                                                                                                                                 |
| Single model per provider (not a full matrix)                                 | Balances signal vs. cost/runtime. Easy to extend later.                                                                                                                                                                                        |
| `describe.skipIf(!hasApiKey(...))` (not `it.skipIf`)                          | Skipping at the describe level is clearer in output: when OPENAI_API_KEY is absent, the entire OpenAI block is reported as one skip rather than one per case.                                                                                  |

---

_Generated 2026-04-04_
