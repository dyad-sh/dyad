# Hybrid harness cleanup — confirmed review findings for PR #3807

Fixes for the 11 findings confirmed by the adversarial review of the hybrid
renderer+IPC harness (PR #3807). Each item names the defect, the fix shipped in
this change, and how it is verified. Refuted candidates (IPv6 bind, renderer
listener isolation, usage-promise observability, monaco VITEST leak, aria
snapshot breakage) are intentionally absent.

Supersedes the stale portions of `plans/hybrid-harness-improvements.md` (see
the status header added there).

---

## 1. Stale-event stream waits (live bug in main.integration.test.ts)

**Defect.** `waitForStreamEnd` scanned the full, never-cleared
`bridge.sentEvents` history, so any turn after the first resolved instantly on
a prior turn's `chat:response:end`. `main.integration.test.ts`'s second test
hit this today: its end-of-stream gate was a no-op. 15 call sites used the
unsafe variant vs 13 safe (`waitForNextStreamEnd`).

**Fix.** `waitForStreamEnd` now _consumes_ matching events: each call (keyed by
`chatId`) returns the next not-yet-consumed `chat:response:end`, waiting if it
hasn't arrived. First-turn ergonomics are unchanged (a historical first end
still resolves immediately); a second call in the same test now genuinely waits
for the second turn. `waitForNextStreamEnd` remains for capturing an explicit
pre-action baseline. The JSDoc WARNING and the HYBRID_HARNESS.md §5 footgun
text are replaced by the new semantics.

**Verify.** main.integration.test.ts passes unmodified but now actually waits
(assert by adding a temporary log if needed); full integration suite green.

## 2. Forgiving electron mock: duplicate handler registration

**Defect.** The mock's `ipcMain.handle` was a bare `Map.set`; real Electron
throws `Attempted to register a second handler`. The harness itself depended
on the divergence (chat:stream registered by both `setupChatFlowHarness` and
`registerIpcHandlers()`), so a real double-registration bug in app code would
pass every test and crash production at startup. `handleOnce` never removed
itself.

**Fix.** The mock now throws on duplicate `handle`/`handleOnce` with Electron's
message, and `handleOnce` deregisters after the first invoke. The hybrid path
no longer double-registers: `setupChatFlowHarness` accepts
`registerChatStreamHandlers: false` and the hybrid harness passes it, relying
on `registerIpcHandlers()`. `dispose()` clears the shared handler/listener maps
(the moral equivalent of the Electron process exiting) so sequential harnesses
in one process (the guard test) still work.

**Verify.** Guard test (sequential setups) green; a duplicate `handle` in a
scratch test throws.

## 3. Bridge skips the preload channel whitelist

**Defect.** Real preload throws `Invalid channel: <name>` for any channel not
derived into `src/ipc/preload/channels.ts`; the bridge invoked any registered
handler, so whitelist drift (raw `ipcMain.handle` + raw invoke) was invisible
to the whole integration suite.

**Fix.** The bridge enforces the same `VALID_INVOKE_CHANNELS` /
`VALID_RECEIVE_CHANNELS` lists (plus preload's dynamic `terminal:*` allowance)
with the same thrown message, on `invoke`/`invokeEnvelope`/`on`/
`removeListener`/`removeAllListeners`. Bridge unit tests that use synthetic
channel names opt out via a new `validateChannels: false` option; the hybrid
harness always validates.

**Verify.** New bridge unit test asserts the `Invalid channel` throw; full
integration suite green (any failure = real whitelist drift, fix at source).

## 4. Bridge passes objects by reference (no structured clone)

**Defect.** Real IPC structured-clones args, results, and event payloads;
the bridge shared references, so non-cloneable values (functions, class
instances) and cross-boundary mutation aliasing passed in tests but break in
production.

**Fix.** The bridge `structuredClone`s invoke args, fulfilled results, and
main→renderer event payloads (behind the same `validateChannels`-style option
default: on). A handler returning a non-cloneable value now fails the test,
matching Electron.

**Verify.** Bridge unit test with a function-valued result asserts the clone
error; integration suite green.

## 5. settleInFlight swallows its timeout

**Defect.** On timeout it `console.warn`ed and returned success, then
`dispose()` closed the sqlite singleton under still-running handlers — a hung
handler was indistinguishable from a clean teardown.

**Fix.** `settleInFlight` now rejects on timeout with the pending channel list.
Hybrid `dispose()` captures that error, still completes the rest of teardown
(bridge uninstall, node dispose), then rethrows — so the failure is loud but
teardown doesn't leak the db/temp dir.

**Verify.** Bridge unit test updated from "warns" to "throws with pending
channels"; forced-timeout path exercised.

## 6. Harness env mutation never restored

**Defect.** Setup overwrote `DYAD_DEV_USER_DATA_DIR`, `FAKE_LLM_*`,
`DYAD_LANGUAGE_MODEL_CATALOG_URL`, `DYAD_ENGINE_URL`, `DYAD_GATEWAY_URL` (and
the hybrid layer `DYAD_SKIP_MANAGED_PNPM_INSTALL`) and dispose restored none,
so a sequential harness inherited stale URLs pointing at a closed port.

**Fix.** Setup snapshots the prior value of every env var it touches; dispose
(and the setup error path) restores or deletes them. The hybrid layer does the
same for `DYAD_SKIP_MANAGED_PNPM_INSTALL` and the fetch override (already
reset).

**Verify.** Guard test (sequential setups) green; scratch assertion that
`DYAD_ENGINE_URL` is unset after an `engine: true` harness disposes.

## 7. vitest project globs contradict the naming rule

**Defect.** `rules/hybrid-testing.md` says to name cross-module tests
`*.integration.test.ts(x)` anywhere, but the integration project's globs
matched only two hard-coded paths — a rule-following test elsewhere landed in
the unit project without the electron/posthog/i18n mocks or forks pool.

**Fix.** Integration globs broadened to `src/**/*.integration.test.{ts,tsx}`
(unit project excludes the same). `rules/hybrid-testing.md` documents the
routing and the deliberate exception: node-layer self-managed harness tests
(e.g. `chat_flow_harness.smoke.test.ts`) keep a plain `.test.ts` suffix because
they bring their own environment pragma and electron mock.

**Verify.** `npx vitest run --project integration` lists the same files as
before; unit project count unchanged.

## 8. Test-escape hooks live in shipped builds

**Defect.** `setModelClientFetchForTesting`'s `NODE_ENV === "production"`
guard is dead code (packaged builds never set NODE*ENV), leaving a
fetch-interception seam armable in shipped binaries;
`DYAD_SKIP_MANAGED_PNPM_INSTALL` was ungated (unlike the `IS_TEST_BUILD`-gated
`DYAD_TEST*\*` escapes) and skipped silently.

**Fix.** The fetch seam moves to `src/ipc/utils/test_fetch_override.ts` and the
setter throws unless running under vitest (`process.env.VITEST`) or an E2E
test build (`IS_TEST_BUILD`) — loud instead of silently armable.
`scheduleManagedPnpmInstall`'s skip is gated the same way and logs one line.

**Verify.** Unit test: calling the setter with both env signals absent throws;
pnpm skip logs and only fires under test envs.

## 9. Fetch seam not threaded into secondary model-client factories

**Defect.** The undici override reached only `get_model_client.ts` factories;
`provider_api_key_validation_service.ts` (`createGoogle`,
`createOpenAICompatible`, `createDyadEngine`), `help_bot_handlers.ts`
(`createOpenAI`), and `transcribeWithDyadEngine` fell back to happy-dom's
fetch — a hang-shaped trap for the first hybrid test that exercises them.

**Fix.** With the seam in its own module (no import cycles), those sites spread
`...getTestFetchOption()` like the primary factories.

**Verify.** Grep: every `create*(` model-client factory in src/ipc passes the
option; typecheck green.

## 10. responsesHandler dump filenames can collide

**Defect.** This PR gave `chatCompletionHandler` collision-proof
`<timestamp>-<rand>.json` dump names but left `responsesHandler` at
`<timestamp>.json`, breaking the harness's "lexical sort is chronological /
unique" assumption for Responses-API dumps (exercised by engine specs).

**Fix.** Same suffix scheme in `responsesHandler.generateDump`.

**Verify.** Grep both handlers for the shared pattern.

## 11. Fixed 1.5s sleep in cancelled_message + stale improvements plan

**Defect.** `cancelled_message.integration.test.ts` slept a fixed 1 500 ms
before clicking Cancel (pure latency; the deterministic condition is "the
handler registered the stream and wrote the user + placeholder rows").
Separately, `plans/hybrid-harness-improvements.md` ships describing debts this
same PR already fixed (per-mount store, setup file, `bridge.once`, fetch seam,
renderer wiring extraction), so it reads as an active plan for finished work.

**Fix.** The sleep is replaced by waiting for `chat:stream:start` plus the two
db rows (user prompt + assistant placeholder) — the exact preconditions the
later assertions need. The improvements plan gets a status header marking each
item shipped/superseded and pointing here.

**Verify.** cancelled_message green twice; runtime drops by ~1.4s.
