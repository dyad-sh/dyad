# Fix auto-fix-problems: remove per-turn problem scans that duplicate the agent's checks

## Problem

With `enableAutoFixProblems` on, every stream that updates files triggers a renderer-side
problems refresh (`useStreamChat.ts:432-438` invalidates the problems query →
`useCheckProblems` refetches → `checkProblems` IPC → `generateProblemReport` → a full
`ts.createIncrementalProgram` build). This fires in **all** modes, including local-agent —
where the agent already runs `run_type_checks` itself (also a full program build, regardless
of its `paths` argument).

Net effect in local-agent mode on a large app: the same multi-second, 1–3 GB-transient
type-check runs at least twice per turn, moments apart. Today those builds run in a
worker_thread inside the main process's shared 4 GB V8 cage, so the duplication doubles the
frequency of the exact allocation spike implicated in the EXC_BREAKPOINT crash reports (see
`plans/memory-report.md`). Even after the TSC worker moves to a utilityProcess, it remains
duplicated CPU/latency for zero benefit.

Note: the auto-fix LLM loop itself (`chat_stream_handlers.ts:1720-1860`) already never runs in
local-agent mode (that path returns at `:1496`) — the redundancy is only in the renderer-side
scan machinery the setting drags along.

**Decision:** drop the automatic post-turn scan for local-agent turns. It is acceptable that
the Problems panel does not auto-update after agent turns, as long as the UI says so.

## Trigger inventory (keep / remove)

| Trigger                                             | Location                                              | Verdict                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Post-stream invalidation on `response.updatedFiles` | `src/hooks/useStreamChat.ts:432-438`                  | **Remove for local-agent turns** — this is the per-turn duplicate. Keep for build mode (it's the only thing refreshing the panel there). |
| After approving a proposal                          | `src/components/chat/ChatInput.tsx:743-745`           | Keep — build-mode flow, user-initiated apply.                                                                                            |
| After manual file save                              | `src/components/preview_panel/FileEditor.tsx:284-285` | Keep — user-initiated, mode-independent.                                                                                                 |
| Manual refresh in Problems panel                    | `src/components/preview_panel/Problems.tsx:88-97`     | Keep — explicit user action; becomes the way to refresh after agent turns.                                                               |
| Query mount when panel opens                        | `src/hooks/useCheckProblems.ts:22`                    | Keep — it's what populates the panel at all; unchanged behavior.                                                                         |

## Implementation

1. **Gate the post-stream invalidation by mode** (`useStreamChat.ts:432`): skip the
   `queryClient.invalidateQueries` for the problems key when the turn ran in local-agent mode.
   The hook has `settings` in scope; use `settings.selectedChatMode === "local-agent"`.
   (Ask/plan modes route through local-agent read-only and don't produce `updatedFiles`, so
   they're moot; if a mode value is ambiguous, prefer skipping only for `"local-agent"`.)
   Edge: user flips mode mid-stream — acceptable imprecision; do not thread mode through the
   stream response unless it's already available.
2. **Problems panel notice** (`src/components/preview_panel/Problems.tsx`): when the selected
   chat mode is local-agent, render a small inline note: problems do not auto-refresh after
   agent turns because the agent runs its own type checks; point at the existing manual
   refresh action (already wired via `checkProblems`, `:97`).
3. **Switch copy** (`src/components/AutoFixProblemsSwitch.tsx`): clarify scope in the
   tooltip/description — auto-fix applies to Build mode; in Agent mode the agent type-checks
   itself and the panel refreshes manually. Update the i18n keys it uses
   (`workflow.autoFixProblems` — add strings to all locale files, matching existing i18n
   patterns).
4. No main-process changes. No settings schema changes.

## Testing

- Unit: if `useStreamChat` has hook tests, add a case asserting no problems-query invalidation
  when mode is local-agent and one asserting it still fires in build mode. Otherwise cover via
  the lightest existing pattern (don't build new test infra for this).
- Grep e2e specs for auto-fix/problems coverage (`e2e-tests/`) and confirm none assert the
  panel auto-refreshing after agent turns; adjust if one does.
- Manual: agent turn with setting on → no `checkProblems` IPC fires post-turn (observable in
  logs); build turn → panel still refreshes; manual refresh still works in agent mode.

## As built (PR #3864)

Two corrections discovered during implementation:

- **Gate signal**: `settings.selectedChatMode` was the wrong key — chat mode is per-chat, not
  a setting, so that gate never activates in practice. The implementation gates on the
  `effectiveChatMode` chunk the main process already emits at stream start
  (`chat_stream_handlers.ts:694`), captured per-stream in `useStreamChat`, with the settings
  value only as fallback. This also removes the mid-stream mode-flip imprecision accepted
  above.
- **Smaller UX loss than planned**: the Problems panel already updates when the agent runs
  `run_type_checks` (report pushed via `agent-tool:problems-update`). Only the redundant
  renderer-initiated rescan is removed; the panel is stale only after agent turns where the
  agent didn't type-check. Notice copy reflects this.

Switch description copy lives in `src/pages/settings.tsx` (hardcoded English, like siblings),
not `AutoFixProblemsSwitch.tsx`; updated there + `settings.workflow.autoFixProblemsDescription`
in all 4 locales.

## Out of scope (future work)

- Sharing/caching the `ProblemReport` between `run_type_checks` and `checkProblems` keyed by a
  codebase mtime signature — would make panel refreshes free after agent checks and also
  dedupe build-mode work. Complementary, not required for this fix.
- The `run_type_checks` `paths` argument not narrowing the actual program (post-filter only) —
  tracked in `plans/memory-report.md` Tier 1.
