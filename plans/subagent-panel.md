# Sub-Agent Panel UX

> Design for a scalable sub-agent UX: compact chat cards, an "Agents" right-side panel, and an active-agents strip above the chat input. First consumer: Code Explorer. Next: Reviewer.

## Problem

The Code Explorer sub-agent (`explore_code`) produces rich structured data on the backend — per-step tool observations (`SubagentObservation[]`), scored file candidates with ranges (`ExplorerCandidate`), and a final report with confidence/action/paths (`ReportMachine`) — but everything is flattened to a single markdown string before crossing IPC (`explore_code.ts` → `<dyad-explore-code>` tag body). The frontend (`src/components/chat/DyadExploreCode.tsx:100-106`) dumps that string into a `<CodeHighlight language-markdown>` block inside a chat card. The result is an ugly wall of markdown-ish text, and none of the structure is usable for real UI.

This design also needs to scale: more sub-agents are coming (e.g., a Reviewer), and each should get a decent UI for free without redesigning chat rendering each time.

## Decisions (confirmed with Will)

1. **Data path**: structured JSON in the custom tag body (no new DB table / IPC channel). Survives reload via existing message persistence; streams via the existing preview overlay.
2. **Panel home**: a new **"Agents" tab** in the right-side preview panel (new `PreviewMode`, like the Plan tab), with an activity indicator while an agent runs.
3. **Panel scope**: **run list + detail** — all sub-agent runs in the current chat, newest first, live runs pinned on top; clicking a chat card deep-links to that run.
4. **Chips above chat input**: appear while running; completed chips **linger until the assistant's turn ends** (with done/failed state), then disappear.

## UX Overview

### 1. Chat card (compact summary)

Replaces the current expandable markdown card. One row, never expands inline — clicking it opens the Agents panel deep-linked to that run.

While running (updates live as steps stream):

```
┌─────────────────────────────────────────────────────────────┐
│ ⚙ [EXPLORER] "how does auth token refresh work?"            │
│   ↳ step 3/12 · grep "refreshToken" → 7 matches      ⟳  ↗  │
└─────────────────────────────────────────────────────────────┘
```

When finished:

```
┌─────────────────────────────────────────────────────────────┐
│ ✓ [EXPLORER] "how does auth token refresh work?"            │
│   high confidence · 4 files · 8 steps · 12.3s           ↗  │
└─────────────────────────────────────────────────────────────┘
```

- The second line is the **latest step summary** while running, and a **result summary** when done (confidence + file count for Explorer; each agent type defines its own summary).
- `↗` affordance signals "opens panel" (whole card is clickable).
- Error/aborted states reuse `DyadStateIndicator`.

### 2. Active sub-agents strip (above chat input)

A horizontal chip strip rendered inside the composer container in `ChatInput.tsx`, stacked with `TodoList` / `AgentConsentBanner` (the ~line 823-868 region). Only rendered when the current turn has sub-agent runs.

```
┌──────────────────────────────────────────────────────────────┐
│ ⟳ Explorer · grep "refreshToken"…   ✓ Reviewer · 3 findings │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Type a message...                                        │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- Running chip: agent icon + name + spinner + truncated latest-step snippet.
- Completed chip: check/error icon + name + one-line result; lingers until the turn (streaming) ends, then the strip clears.
- Click any chip → open Agents panel, select that run.

### 3. Agents panel (right side)

New `PreviewMode = "agents"` with a toolbar tab. Tab button shows a pulsing dot while any run in the current chat is live.

```
┌─ Agents ────────────────────────────────────────────────────┐
│ ┌─ Runs ─────────────────────────────────────────────────┐  │
│ │ ⟳ Explorer  "auth token refresh"          running      │  │
│ │ ✓ Explorer  "settings persistence"        2m ago       │  │
│ │ ✓ Reviewer  "PR #42 diff"                 10m ago      │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                             │
│ ┌─ ⟳ Explorer · "auth token refresh" ────────────────────┐  │
│ │ Steps                                                  │  │
│ │  1 ✓ explore_code "token refresh"    → 5 candidates  ▸ │  │
│ │  2 ✓ read_file src/auth/refresh.ts   → 120 lines     ▸ │  │
│ │  3 ⟳ grep "refreshToken"                               │  │
│ │                                                        │  │
│ │ Output                          [high confidence] ⚑    │  │
│ │  Flow:                                                 │  │
│ │   • src/auth/refresh.ts:12-48  scheduleRefresh()  ↗    │  │
│ │   • src/auth/session.ts:88-102 consumes token     ↗    │  │
│ │  Read targets: src/auth/refresh.ts:12-48 …             │  │
│ └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- **Run list** (top, compact): every sub-agent run in the current chat, newest first, live runs pinned. Selecting a run swaps the detail view. Auto-selects the live run when the panel opens via toolbar/chip with no explicit target.
- **Detail — steps**: timeline of steps, each with a tool icon, one-line summary, status, and an expandable detail (args + result excerpt). Live run appends steps as they stream.
- **Detail — output**: agent-type-specific rich rendering. For Explorer: confidence badge, action, flow entries with **clickable `path:range` links** that jump to the Code tab (`selectedFileAtom` + `previewModeAtom = "code"` — same mechanism as `FileTree.tsx`), quotes, missing items, read targets. Unknown/future agent types fall back to a markdown rendering of their output.

## Architecture

### Shared run model

New shared types in `src/shared/subagent_types.ts` (renderer + main both import):

```ts
export type SubagentType = "code-explorer" | "reviewer"; // extend over time

export type SubagentRunStatus = "running" | "completed" | "aborted" | "error";

export interface SubagentStepEvent {
  kind: "step";
  index: number;
  toolName: string;
  summary: string; // one line, human-readable ("grep \"refreshToken\" → 7 matches")
  detail?: string; // expandable: args + result excerpt (truncated on backend)
  status: "running" | "done" | "error";
}

export interface SubagentOutputEvent {
  kind: "output";
  summary: string; // one line for card/chip ("high confidence · 4 files")
  data: unknown; // agent-type-specific structured output (see Explorer below)
  markdown?: string; // fallback rendering for unknown types
}

export interface SubagentMetaEvent {
  kind: "meta";
  title: string; // e.g. the query
  startedAt?: number;
  finishedAt?: number;
  stats?: Record<string, string | number>; // steps, files, durationMs…
}

export type SubagentEvent =
  | SubagentStepEvent
  | SubagentOutputEvent
  | SubagentMetaEvent;
```

Explorer's `SubagentOutputEvent.data`:

```ts
interface ExplorerOutputData {
  intent: string;
  confidence: "high" | "medium" | "low";
  action:
    | "answer_from_report"
    | "read_targets"
    | "targeted_gap_search"
    | "skip_explore_result";
  flow: Array<{
    path: string;
    range: string | null;
    role: string;
    quote?: string;
  }>;
  missing: string[];
  readTargets: Array<{ path: string; range: string | null }>;
}
```

### Data path: `<dyad-subagent>` tag with NDJSON body

A new generic tag replaces `<dyad-explore-code>` for new runs:

```xml
<dyad-subagent type="code-explorer" run-id="r_abc123" title="how does auth token refresh work?" status="running">
{"kind":"meta","title":"how does auth token refresh work?","startedAt":1770000000}
{"kind":"step","index":1,"toolName":"explore_code","summary":"explore_code \"token refresh\" → 5 candidates","status":"done","detail":"..."}
{"kind":"step","index":2,"toolName":"read_file","summary":"read src/auth/refresh.ts → 120 lines","status":"done"}
{"kind":"output","summary":"high confidence · 4 files","data":{...},"markdown":"## explore_code report\n..."}
</dyad-subagent>
```

**Why NDJSON, not one JSON blob:** the body streams incrementally through the preview overlay (`onXmlStream` re-sends the accumulated XML each tick). A single JSON object would be unparseable until complete; NDJSON lets the frontend parse every complete line and ignore the trailing partial line. Each step is appended as one line; the output event is the last line before the closing tag.

Notes:

- `run-id` is generated in `explore_code.ts` per invocation (needed to correlate chips/panel selection and to dedupe the streaming overlay against committed content).
- The tag body is **UI-only**. The tool's return value to the parent LLM (the markdown report from `buildReport`) is unchanged.
- **Escaping**: JSON lines must not contain literal `</dyad-subagent>`; backend escapes `<` as `<` inside JSON strings (JSON.stringify with a replacer or post-process). This is the one sharp edge of in-tag transport — call it out in tests.
- **Backward compatibility**: `DyadExploreCode.tsx` and its parser case stay for old persisted messages. New runs emit only `dyad-subagent`.

### Backend changes

All in `src/pro/main/ipc/handlers/local_agent/`:

1. **`subagent_ui.ts` (new)** — shared emitter used by any sub-agent tool:
   ```ts
   createSubagentUiEmitter({ type, runId, title, ctx }) => {
     onStep(event), onOutput(event), fail(err), abort()
   }
   ```
   Internally accumulates events, serializes the tag, and calls `ctx.onXmlStream` per step / `ctx.onXmlComplete` at the end (same lifecycle `explore_code.ts:126-155` uses today).
2. **`tools/explore_code.ts`** — swap the hand-built `<dyad-explore-code>` strings for the emitter. Progress callback maps each new `SubagentObservation` to a `SubagentStepEvent` (reuse the per-line summaries from `formatExploreProgressLog` in `explore_code_subagent_progress.ts`, split into per-step events instead of one growing text block).
3. **`tools/explore_code_subagent_report.ts`** — add `buildStructuredOutput(selection): ExplorerOutputData` alongside `buildReport` (the data already exists in `ResolvedSelection`; this is a projection, not new computation). `markdown` field = existing `buildReport` output.

### Frontend changes

1. **Parser**: register `dyad-subagent` in the custom tag list and add a case in `DyadMarkdownParser.tsx`'s tag switch (next to the `dyad-explore-code` case at ~line 753). Attributes → props; children (NDJSON) parsed by a small `parseSubagentEvents(body): { events, meta, steps, output }` util in `src/components/subagents/parseEvents.ts` (tolerant of a trailing partial line; unit-tested).
2. **Agent registry** — `src/components/subagents/registry.tsx`:
   ```ts
   interface SubagentDescriptor {
     label: string; // "Explorer", "Reviewer"
     icon: LucideIcon;
     accentColor: DyadCardAccent; // teal for explorer
     renderOutput?: (data: unknown) => ReactNode; // rich final-output view
   }
   export const SUBAGENT_REGISTRY: Record<SubagentType, SubagentDescriptor>;
   ```
   Unknown types get a default descriptor (generic bot icon, markdown fallback output). **This is the whole cost of onboarding a new sub-agent's UI**: one registry entry + optionally one output renderer.
3. **Run state** — `src/atoms/subagentAtoms.ts` + `src/hooks/useSubagentRuns.ts`:
   - Runs are **derived, not duplicated**: a hook parses `dyad-subagent` blocks out of the current chat's messages (committed content) and merges the live overlay from `streamingPreviewByChatIdAtom` (dedupe by `run-id`, overlay wins while streaming). Memoized per message id + preview string.
   - `selectedSubagentRunIdAtom: atom<string | null>` — panel selection; reset on chat switch.
   - `openSubagentPanel(runId?)` helper: `setSelectedRun(runId ?? latestLive)`, `previewModeAtom = "agents"`, `isPreviewOpenAtom = true`.
   - Run status derives from the tag's `state` (`CustomTagState` via existing `getState`) + `status` attribute; aborted streams (parser sees unclosed tag with `isStreaming = false`) map to `aborted`, steps preserved.
4. **Chat card** — `src/components/subagents/SubagentCard.tsx`, rendered by the parser for `dyad-subagent`. Uses `DyadCardPrimitives` (same shell as today's card, so it visually belongs with `DyadWrite`/`DyadGrep` siblings) but with a fixed two-line layout, no expand — `onClick={() => openSubagentPanel(runId)}`. Latest-step line reads the last parsed step event.
5. **Panel** — `src/components/preview_panel/AgentsPanel.tsx`:
   - Add `"agents"` to `PreviewMode` in `src/atoms/appAtoms.ts`, a case in `PreviewPanel.tsx`'s mode switch (~line 230), and a tab button in `PreviewToolbar.tsx` (with live-run pulse dot driven by `useSubagentRuns`).
   - `RunList` + `RunDetail` (steps timeline + output section). Explorer output renderer lives in `src/components/subagents/explorer/ExplorerOutput.tsx`; file links set `selectedFileAtom` + `previewModeAtom = "code"`.
6. **Chips strip** — `src/components/subagents/ActiveSubagentsBar.tsx`, mounted in `ChatInput.tsx` beside `TodoList` (~line 827). Shows runs from the **current streaming turn** (runs whose message is the one being streamed); clears when `isStreaming` for the chat ends. Chip click → `openSubagentPanel(runId)`.

## Scaling example: Reviewer

A future Reviewer sub-agent tool would:

1. Call `createSubagentUiEmitter({ type: "reviewer", ... })` and emit steps ("read diff for src/foo.ts", "checked test coverage") and an output event (`data: { verdict, findings: [{file, line, severity, message}] }`, `summary: "3 findings · 1 high"`).
2. Add `"reviewer"` to `SubagentType` and one `SUBAGENT_REGISTRY` entry with a findings-table output renderer (file/line links reuse the same jump-to-code helper).

Chat card, chips, run list, step timeline, streaming, persistence, abort handling — all inherited with zero additional work.

## Edge cases

- **Multiple concurrent runs**: run-id keyed everywhere; chips strip and run list handle N runs; live runs pinned in list.
- **Abort mid-run** (user stops the stream): unclosed tag → `aborted` state; parsed steps up to that point remain viewable in the panel; chip shows aborted state until turn end.
- **Old messages**: legacy `<dyad-explore-code>` markdown cards render unchanged; they do not appear in the Agents run list (acceptable — panel is forward-looking).
- **Partial NDJSON line** during streaming: parser drops the incomplete trailing line; next tick completes it.
- **Panel opened from toolbar with no runs**: empty state ("No agent runs in this chat yet") with a one-line explanation of what sub-agents are.
- **Chat switch**: selected run resets; run list re-derives from the new chat's messages.

## Implementation phases

1. **Shared types + backend emitter**: `subagent_types.ts`, `subagent_ui.ts`, `buildStructuredOutput`, rewire `explore_code.ts`. Old tag no longer emitted for new runs.
2. **Parser + card**: tag registration, `parseEvents.ts` (+ unit tests incl. escaping and partial-line cases), registry, `SubagentCard`. At this point the ugly card is gone even before the panel exists.
3. **Agents panel**: `PreviewMode` addition, toolbar tab with pulse, `AgentsPanel` (run list, step timeline, Explorer output renderer with jump-to-code), deep-link from card.
4. **Chips strip**: `ActiveSubagentsBar` in `ChatInput`, turn-scoped lifecycle.
5. **Polish + tests**: e2e (card click opens panel on the right run; live steps stream into panel; chip lifecycle), `data-testid`s (`subagent-card`, `agents-panel`, `subagent-chip`), dark/light styling pass.

## Open questions (non-blocking)

- Should the Agents tab hide entirely when the chat has no runs and the feature flag (`enableCodeExplorer`) is off? Proposed: yes — render the tab only when runs exist or a Pro sub-agent feature is enabled.
- Step `detail` truncation budget (backend): proposed 2 KB per step to keep message rows small.
- Whether the run list should eventually span all chats of the app (session-wide agent activity). Out of scope here; the run-list component should not assume chat-scoping in its props.
