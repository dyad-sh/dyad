# Chat-flow harness — migration cookbook

`setupChatFlowHarness` runs the **real** dyad chat flow as a fast vitest
integration test, without launching Electron. Use it to migrate Playwright
`e2e-tests/*.spec.ts` chat specs into `*.integration.test.ts` files.

What is real: the `chat:stream` IPC handler, a real sqlite db (the app's own
`initializeDatabase()` + drizzle migrations), a real settings file, a real git
checkout of an e2e fixture app, the real AI-SDK streaming client talking HTTP to
the real fake-LLM server (the same one Playwright uses — serving
`e2e-tests/fixtures/*.md` via the `tc=<name>` protocol, with tool-calls, the
`[dump]` mechanism, the GitHub/engine/gateway/anthropic routes, per-test
counters), and the real response processor (dyad-tag parsing, file writes, git
commits, db message rows).

What is mocked: only the `electron` module (`src/testing/electron_mock.ts`).

A typical migrated test is ~2.5–3.5s. The proven reference is
`src/testing/chat_flow_harness.smoke.test.ts` (the harness's own smoke test) and
the two migrated specs under `src/ipc/handlers/__tests__/`.

> ⚠️ **Migration agents MUST NOT edit the harness files**
> (`chat_flow_harness.ts`, `electron_mock.ts`, `server_dump.ts`, or anything in
> `testing/fake-llm-server/`). If you hit a gap (a fixture that doesn't route, a
> missing option, a normalization you need), **report it** — do not patch the
> harness yourself. Migrations must stay uniform.

---

## 1. Test-file skeleton

Copy this preamble verbatim. The three things it must do — set
`NODE_ENV=development` before app modules import, register a hoisted
`ipcHandlers` Map, and mock `electron` — can only happen via `vi.hoisted` +
`vi.mock`, so they cannot be hidden inside the harness.

```ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("my feature (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("does the thing", async () => {
    const { result, messages } = await harness.streamChat("tc=my-fixture");
    expect(result).toBe(harness.chatId);
    // ...assert files / git / db / dump...
  }, 30_000);
});
```

- **`// @vitest-environment node` is required.** The repo default is happy-dom,
  whose `fetch` enforces browser CORS and blocks the AI SDK's request to the
  local fake server. Main-process code needs plain node.
- Place migrated files under `src/ipc/handlers/__tests__/` and name them
  `*.integration.test.ts`. (vitest picks up any `src/**/*.{test,spec}.{ts,tsx}`.)

---

## 2. `setupChatFlowHarness(options)`

`electronMock` (the hoisted `h`) is the only required option.

| Option            | Default                                                                            | Purpose                                                            |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `electronMock`    | — (required)                                                                       | The hoisted `{ ipcHandlers }` you passed to `vi.mock("electron")`. |
| `fixtureApp`      | `"minimal"`                                                                        | Which `e2e-tests/fixtures/import-app/<name>` app to check out.     |
| `autoApprove`     | `true`                                                                             | Auto-approve proposed changes (writes+commits happen inline).      |
| `chatMode`        | `"build"`                                                                          | `selectedChatMode`.                                                |
| `enableNativeGit` | `true`                                                                             | Use native git for commits.                                        |
| `selectedModel`   | `{ provider:"testing", name:"test-model" }`                                        | Settings model selection.                                          |
| `provider`        | `{ id:"testing", name:"test-provider", apiBaseUrl:"<fake>/v1" }`                   | Custom provider row.                                               |
| `model`           | `{ displayName/apiName:"test-model", maxOutputTokens:8192, contextWindow:128000 }` | Custom model row.                                                  |
| `settings`        | `{}`                                                                               | Arbitrary `Partial<UserSettings>` overrides (highest precedence).  |
| `useFakeCatalog`  | `true`                                                                             | Point `DYAD_LANGUAGE_MODEL_CATALOG_URL` at the fake server.        |
| `verboseFakeLlm`  | `false`                                                                            | Show the fake server's per-request logs (else quiet).              |

### Harness object

```ts
harness.db            // the app's drizzle db (process singleton)
harness.appDir        // temp path of the checked-out fixture app + git repo
harness.appId         // apps row id
harness.chatId        // chats row id
harness.userDataDir   // temp userData dir (holds the sqlite db, settings)
harness.fakeLlmUrl    // e.g. http://127.0.0.1:<ephemeralPort>
harness.fakeLlmPort   // the bound port

harness.streamChat(prompt, opts?)   // run chat:stream, resolves at stream end
harness.getServerDump(opts?)        // read + normalize a fake-server [dump]
harness.getAppFiles()               // [{ relativePath, content }] sorted
harness.readAppFile(rel)            // string, throws if missing
harness.appFileExists(rel)          // boolean
harness.gitLog()                    // ["<sha> <subject>", ...] newest first
harness.dispose()                   // close server + db, rm temp dir
```

### `streamChat(prompt, opts?) => StreamChatResult`

`opts` are forwarded to the `chat:stream` params, so you can pass
`redo`, `attachments`, `selectedComponents`, `requestedChatMode`, and even a
different `chatId`.

```ts
interface StreamChatResult {
  chatId: number;
  result: unknown; // handler return: chatId on success, "error" on failure
  events: RendererEvent[]; // every event.sender.send({channel,payload})
  messages: Message[]; // chat messages, ascending by id
  event(channel): RendererEvent | undefined;
  eventsFor(channel): RendererEvent[];
  getServerDump(opts?): ServerDumpResult;
}
```

Common renderer channels: `chat:stream:start`, `chat:response:chunk`,
`chat:response:end` (payload `{ chatId, updatedFiles }`), `chat:stream:end`,
`chat:response:error`.

---

## 3. `tc=<fixture>` prompt protocol

A prompt of `tc=<name>` makes the fake server stream the contents of
`e2e-tests/fixtures/<name>.md` back as the assistant message (same mapping the
Playwright suite uses). The response then flows through the real tag processor.

- `tc=dyad-write-angle` → streams a `<dyad-write path="src/foo/bar.tsx">` (see
  `dyad_tags_parsing.integration.test.ts`).
- Nested fixtures: `tc=engine/...` etc. resolve under `e2e-tests/fixtures/`.

Other magic prompts the fake server understands (from `chatCompletionHandler`):
`[dump]` (writes the request payload to disk — see §5), `[increment]` (monotonic
`counter=N`), `[429]` (rate-limit error), `[high-tokens=N]` (usage in final
chunk), `[call_tool=calculator_add]` (streamed tool call), `[sleep=medium|long]`.
An arbitrary prompt with no marker returns the built-in `CANNED_MESSAGE`
(a `<dyad-write path="file1.txt">`), **not** an echo — mirror what the fixture
actually returns, don't assume the old spike's `Echo:` behavior.

---

## 4. Asserting files / git / db

```ts
// Files written by dyad-write tags:
expect(harness.appFileExists("src/foo/bar.tsx")).toBe(true);
expect(harness.readAppFile("src/foo/bar.tsx").trim()).toBe(
  "// BEGINNING OF FILE",
);

// Commit happened (init commit + the applied change):
expect(harness.gitLog().length).toBeGreaterThan(1);

// DB messages:
const { messages } = await harness.streamChat("tc=...");
const assistant = messages.find((m) => m.role === "assistant")!;
expect(assistant.approvalState).toBe("approved");
expect(assistant.commitHash).toBeTruthy();

// Whole-tree snapshot (equivalent to Playwright snapshotAppFiles), masked:
expect(harness.getAppFiles()).toMatchSnapshot();
```

---

## 5. Asserting the LLM request payload (`[dump]`)

When the flow hits a `[dump]` (or a fixture that appends one), the fake server
writes the request body to a private temp dir and embeds
`[[dyad-dump-path=...]]` in its reply. `harness.getServerDump()` reads the
newest dump and applies the **same normalizations** as Playwright's
`PageObject.snapshotServerDump`, so payload snapshots stay deterministic.

```ts
await harness.streamChat("[dump]");

// Prettified transcript (default type "all-messages"):
const dump = harness.getServerDump();
expect(dump.text).toContain("message: [[SYSTEM_MESSAGE]]");
expect(dump.text).toMatchSnapshot();

// Whole request body (JSON), e.g. to assert tool/model shape:
const req = harness.getServerDump({ type: "request" });
expect(req.parsed.body.model).toBe("[[MODEL]]");
```

`getServerDump(options)`:

| Option                 | Default          | Meaning                                                                                                           |
| ---------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `type`                 | `"all-messages"` | `"all-messages"` / `"last-message"` prettify the message list; `"request"` returns the full normalized JSON body. |
| `dumpIndex`            | `-1`             | Which dump when several were produced (`-1` = newest, `0` = first).                                               |
| `maskToolDescriptions` | `true`           | Replace each `tools[].description` with `[[TOOL_DESC:<name>]]`.                                                   |
| `maskModel`            | `true`           | Replace `body.model` with `[[MODEL]]`.                                                                            |

Returns `{ parsed, text, dumpPath }` — `parsed` is the normalized object, `text`
is the stable string for snapshots.

### Normalization / masking rules applied

Shared with the Playwright path (single source of truth —
`e2e-tests/helpers/utils/normalization.ts` + `dump-prettifier.ts`):

- System messages → `[[SYSTEM_MESSAGE]]` (input / messages / anthropic system).
- `.gitattributes` dyad-file blocks and `package.json` dyad-file blocks stripped.
- Tool-call ids → `[[TOOL_CALL_n]]`; MCP `call-id="..."` → `[[MCP_CALL_ID_n]]`.
- `[[dyad-dump-path=...]]` → `[[dyad-dump-path=*]]`; compaction backup paths →
  `[[compaction-backup-path]]`; attachment hashes → `[[ATTACHMENT_*]]`.
- (`type:"request"` only) versioned-file ids → `[[FILE_ID_n]]`; item_reference
  ids → `[[ITEM_REF_n]]`.

Harness-only additions (configurable, on by default):

- `tools[].description` → `[[TOOL_DESC:<name>]]` (OpenAI + Anthropic shapes).
- `body.model` → `[[MODEL]]`.

> Do **not** paste giant unmasked payloads from the old `e2e-tests/snapshots/`.
> Generate a fresh masked snapshot with `toMatchSnapshot()` or make targeted
> assertions. Note the old e2e `dump_messages` used the default new-app scaffold;
> the harness uses the `minimal` fixture, so payloads are smaller and won't match
> the old `.txt` byte-for-byte.

---

## 6. Common pitfalls

- **Missing `// @vitest-environment node`** → the AI SDK request is CORS-blocked
  by happy-dom's fetch. Always include it.
- **Env must be hoisted.** `NODE_ENV=development` has to be set inside
  `vi.hoisted` (before app modules import). The `electron` mock has to be a
  `vi.mock` factory referencing the hoisted `h`. Don't move these into helpers.
- **One harness per test file.** The app's `db` is a process singleton;
  `initializeDatabase()`/`closeDatabase()` are global. Do not create two live
  harnesses in the same file. Sequential `it`s share the one harness (and its
  chat) — later turns append to the same chat.
- **Don't switch vitest to the `threads` pool.** Parallel safety relies on the
  default process-per-file isolation (ephemeral ports, unique temp dirs, private
  dump dir, per-process env + db singleton). Threads would share the db.
- **Real server ≠ echo.** Unmarked prompts return `CANNED_MESSAGE`. Use a
  `tc=` fixture or a magic prompt whose output you know.
- **`getServerDump` needs a dump to exist.** It throws if no `[[dyad-dump-path]]`
  was produced. Trigger `[dump]` (or a fixture that appends one) first.
- **Fixtures resolve in both layouts.** The fake server finds
  `e2e-tests/fixtures` whether imported in-process (source) or run as the built
  CLI (dist). If you add fixtures, put them under `e2e-tests/fixtures/`.

---

## 7. Known gaps and quirks

- **`local-agent` fixtures work**: `tc=local-agent/*` fixtures (loaded via
  `require` + `ts-node/register`) load fine in-process under vitest — the
  `local_agent_*` and `context_compaction` integration tests exercise them,
  including through the engine anthropic route.
- **Dyad Pro / engine routing**: `get_model_client` reads `DYAD_ENGINE_URL` /
  `DYAD_GATEWAY_URL` (and `lm_studio_utils` reads `LM_STUDIO_BASE_URL_FOR_TESTING`)
  at module-import time — before the harness's ephemeral port exists. Tests that
  need these routes start a second fake-LLM server (or a small relay) inside
  `vi.hoisted` and set the env vars before importing app modules; see
  `thinking_budget` / `engine` / `lm_studio` integration tests for the pattern.
  A first-class harness option for this is a welcome follow-up.
- `streamChat({ chatId })` with a chat other than the harness default still
  returns `messages` for the default chat — query `harness.db` directly for
  other chats.
- `chat:stream` resolves `undefined` (not the chatId) for ask/plan/local-agent
  turns; assert success via absence of `chat:response:error` + db rows.
  `chat:cancel` is a typed handler and returns an IPC envelope `{ ok, value }`.
- Harness-created chats have `chatMode: null`; with Dyad Pro enabled,
  `resolveChatModeForTurn` defaults a null stored mode to the local-agent mode.
  Pro build-mode tests must pass `requestedChatMode: "build"` on every
  `streamChat`.
- `getEnvVar` caches `shellEnvSync()` on first call — env vars it reads (e.g.
  `AZURE_*`) must be in `process.env` before anything triggers that cache
  (set them in `vi.hoisted`).
- MCP tool-call flows through `chat:stream` (real stdio subprocess servers)
  remain e2e-only by design.
