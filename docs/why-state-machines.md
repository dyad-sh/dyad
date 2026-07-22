# Why Dyad Uses Explicit State Machines

Dyad's renderer and main process now contain a family of small, hand-rolled
state machines: version preview, plan handoff, app run, connection flow, chat
streaming, and more on the way. This document explains **why** we migrated —
what the code looked like before, what kept breaking, and what a machine buys
us — using real before/after examples from the migration.

This is the rationale document. The **how** — file layout, invariants, test
requirements — lives in [rules/state-machines.md](../rules/state-machines.md),
and the shared plumbing lives in `src/state_machines/`.

A "state machine" here is deliberately boring: a plain TypeScript module with
a pure function `transition(state, event) → { state, commands }`, a small
controller that executes the returned commands, and a `useSyncExternalStore`
binding for React. No XState, no framework — the safety comes from the model,
not a library.

## The disease: orchestration written as component state

Every machine we built replaced the same pattern: a multi-step async workflow
(where ordering matters) implemented as ordinary React/module state. It never
starts out broken. It accretes:

1. A boolean in-progress flag stands in for a state that was never named.
2. An async callback needs fresh values, so a ref starts mirroring reactive
   state.
3. A stale response sneaks through, so a hand-rolled request-id or generation
   counter appears.
4. Two code paths race, so a `setTimeout` "lets state settle".
5. An effect starts *inferring* that a transition happened by diffing
   previous vs. current values.

Each patch is locally reasonable. Together they produce code where the actual
workflow — the thing the user experiences — exists only as an emergent
property of flags that several writers must keep coherent by hand. The bugs
that follow are not typos; they are *unrepresentable-state* bugs: the code
reaches a combination of flags that no one designed, and there is no line to
point at.

The four examples below are real code from this repository.

## Example 1: "Is this chat streaming?" — five answers, three bugs

Before the chat stream machine, "is this chat streaming" was represented in
five places at once — a module-level set, two Jotai atoms, a scroll counter,
and main-process bookkeeping — each patched against the others' races:

```ts
// src/hooks/useStreamChat.ts (before)

// Module-level set to track chatIds with active/pending streams
// This prevents race conditions when clicking rapidly before state updates
const pendingStreamChatIds = new Set<number>();

// …meanwhile, elsewhere:
//   isStreamingByIdAtom            — set false from ~6 different code paths
//   streamCompletedSuccessfullyByIdAtom — a success latch the queue
//                                    processor watched as a covert signal
//   chatStreamCountByIdAtom        — a hand-rolled generation counter
```

That comment — "prevents race conditions when clicking rapidly before state
updates" — is the tell. The set exists because the atom lags renders. Three
concrete, user-reachable bugs fell out of this arrangement: a message
submitted in the lag window was silently dropped after the input was already
cleared; a cancel racing stream startup could desync the UI from disk; and
the queue could dispatch the same message twice.

After: one machine per chat owns the lifecycle. "Starting" — the state the
flags never represented — is a real state, and submitting during it is a
*transition*, decided synchronously, not a flag check that can lag:

```ts
// src/chat_stream/transition.ts (after)
case "idle": {
  switch (event.type) {
    case "submit": {
      const streamId = state.lastStreamId + 1;
      return {
        state: { type: "starting", streamId, request: event.request },
        commands: [{ type: "start-stream", streamId, request: event.request }],
      };
    }
    // …
  }
}
case "starting": {
  switch (event.type) {
    case "submit":
      // A stream is already starting: queue, never drop.
      return {
        state,
        commands: [{ type: "enqueue-message", request: event.request }],
      };
    // …
  }
}
```

The five representations collapsed into one snapshot plus a read-only
projection. The message-drop bug is not "fixed" so much as *unwritable*: there
is no flag to check too early.

## Example 2: detecting "the stream just finished" by diffing renders

Several features needed to react to a stream ending. Without an event to
subscribe to, they reconstructed the transition by comparing the previous
render's value to the current one:

```ts
// src/hooks/useIntegrationContinuation.ts (before)
const prevStreamingRef = useRef<Map<number, boolean>>(new Map());

useEffect(() => {
  const prevStreaming = prevStreamingRef.current;
  const justStopped: number[] = [];
  for (const [chatId, wasStreaming] of prevStreaming) {
    const isStreaming = isStreamingById.get(chatId) ?? false;
    if (wasStreaming && !isStreaming) {
      justStopped.push(chatId);
    }
  }
  prevStreamingRef.current = new Map(isStreamingById);
  // … dispatch continuations for justStopped …
});
```

This works only if React renders between the `true` and `false` writes, runs
on every unrelated render, and each feature that needs it copies the pattern
(we had four copies: integration continuation, chat tab notification dots,
chat panel scroll, test-panel invalidation).

After: the machine already *knows* the exact transition — `finalizing → idle`
— so it emits a signal, and consumers subscribe:

```ts
// src/hooks/useIntegrationContinuation.ts (after)
useStreamFinished(({ chatId }) => {
  const continuationProvider = store
    .get(pendingContinuationProviderAtom)
    .get(chatId);
  // … dispatch the continuation for exactly this chat, exactly once …
});
```

An edge detector *guesses* that a transition happened from its side effects.
A machine *announces* its transitions. The four ref-diffing copies became
four one-line subscriptions.

## Example 3: the load-bearing sleep

The plan-mode handoff (accept a plan → cancel the stream → show confirmation
→ persist → start implementation) was a multi-await saga with a hardcoded
pause in the middle:

```ts
// src/hooks/usePlanEvents.ts (before)
await ipc.chat.cancelStream(payload.chatId);

// Show transitioning state while we prepare the implementation
setPlanState((prev) => { /* add chatId to transitioningChatIds */ });

// Pause so the user can see the "Plan accepted" confirmation
await new Promise((resolve) => setTimeout(resolve, 2500));

setPlanState((prev) => { /* remove chatId from transitioningChatIds */ });

// Read latest values from refs to avoid stale closure
const currentState = planStateRef.current;
```

Nothing guarded re-entry: a second accept, an unmount, or a stream that ended
on its own mid-sleep would interleave with the saga at whatever await it
happened to be parked on. The sleep wasn't a delay — it was a synchronization
primitive, and the refs existed because the closure went stale across it.

After: each step is a state, and the pause is a command whose completion is
just another event:

```ts
// src/plan_handoff/transition.ts (after)
case "cancelling-stream": {
  switch (event.type) {
    case "STREAM_CANCEL_FINISHED":
      return {
        state: { type: "transitioning", session: state.session },
        commands: [{ type: "wait", ms: TRANSITION_DISPLAY_MS }],
      };
    default:
      return ignoreEvent(state, event);
  }
}
case "transitioning": {
  switch (event.type) {
    case "TRANSITION_DISPLAY_DONE":
      return {
        state: { type: "persisting", session: state.session },
        commands: [{ type: "set-preview-mode", mode: "preview" }, /* … */],
      };
  }
}
```

A second accept arriving mid-handoff now hits an exhaustive `switch` and is
deliberately ignored — visible in telemetry — instead of silently interleaving.
And because `transition()` is pure, the whole saga is tested as a table of
(state, event) pairs with no timers and no React.

## Example 4: OAuth returns correlated by timestamp

Connecting Neon (and Supabase) used a global "last deep link" broadcast.
Every mounted connector inferred "a return happened" from a timestamp edge,
and start/timeout/return were coordinated by a ref-managed timer:

```tsx
// src/components/NeonConnector.tsx (before)
useEffect(() => {
  const handleDeepLink = async () => {
    if (lastDeepLink?.type === "neon-oauth-return") {
      if (oauthTimeoutRef.current) clearTimeout(oauthTimeoutRef.current);
      setIsOpeningOauth(false);
      await refreshSettings();
      // … refetch, toast, clearLastDeepLink() …
    }
  };
  handleDeepLink();
}, [lastDeepLink?.timestamp]);

const handleConnect = async () => {
  setIsOpeningOauth(true);
  await ipc.system.openExternalUrl("https://oauth.dyad.sh/…/neon/login");
  // Reset after 20s if the OAuth return never arrives
  oauthTimeoutRef.current = setTimeout(() => {
    setIsOpeningOauth(false);
    toast.warning(t("integrations.neon.signInTimedOut"));
  }, 20_000);
};
```

Reachable absurdities: double-clicking Connect orphaned a timer that later
fired a spurious "timed out" toast; auth completing at second 25 showed
"timed out" *then* "connected"; and a stale or replayed return link would
write credentials with no pending flow to validate against.

After: the connection flow is a main-process machine. Every start mints a
`flowId`; returns and timeouts carry it, so timeout-vs-return is mutually
exclusive by construction and stale returns are ignored — with a reason:

```ts
// src/connection_flow/transition.ts (after)
case "prepared": {
  if (state.status === "disconnected") {
    return ignore(state, "no-active-flow");
  }
  if (state.flowId !== event.flowId) {
    return ignore(state, "flow-id-mismatch");
  }
  switch (state.status) {
    case "starting":
      return advance({
        status: "awaiting-return",
        flowId: state.flowId,
        provider: state.provider,
        // …
      });
    // …
  }
}
```

The timestamp hack, the timer trio, and the credential-overwrite hazard all
reduce to one question the machine can actually answer: *does this event
belong to the flow I started?*

## What a machine buys you

- **Impossible states become unrepresentable.** "Timed out AND connected" or
  "submitted but not starting" aren't flag combinations to defend against —
  they simply cannot be constructed.
- **Races become transitions.** Instead of patching each interleaving as it's
  discovered, the state × event matrix forces a decision for *every* pair up
  front, and totality tests hold you to it.
- **Deliberate no-ops are visible.** `ignore(state, "flow-id-mismatch")` is
  distinguishable from a forgotten case, and observable in telemetry — a
  silent `if` bail-out is neither.
- **One writer.** UI reads a snapshot (or a read-only atom projection);
  nothing else may mutate the workflow state. Multi-writer drift is a lint
  away instead of a debugging session away.
- **Tests need no React and no clocks.** A pure `transition()` is tested as
  data; command runners are faked; timers are injected.

## What we deliberately did not do

- **No XState, no framework.** Four machines produced four *different*,
  load-bearing concurrency models (FIFO queue, runId epochs, flowId
  correlation, per-command rules). A generic controller would be a policy
  framework bigger than the ~150-line controllers it replaced.
- **No premature abstraction.** The shared kernel (`src/state_machines/`)
  contains only what was literally identical across machines: snapshot store,
  keyed controller host, transition/ignore types, React bindings, test kit.
  Concurrency policy stays per-machine, documented in each machine's header.

## When to reach for one — and when not to

Reach for a machine when a workflow has async races, queued work, ordering
that matters, or events that can arrive after the operation was superseded —
especially if you catch yourself adding a ref-mirror, a generation counter,
or a `setTimeout` to "let state settle".

Don't machine-ify plumbing: imperative library handles (xterm, Monaco, DOM
refs), "latest callback" refs, scroll bookkeeping, or plain TanStack Query
fetches are fine as they are. A machine that wraps a single request-response
adds ceremony, not safety.

Start with [rules/state-machines.md](../rules/state-machines.md) for the
conventions, and read any of the existing machines — `src/plan_handoff/` is
the smallest complete example — before writing a new one.
