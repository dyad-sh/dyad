# Chat History Search Tools for Local Agent

> Plan updated 2026-07-15 after critical review

## Summary

Add two bounded, read-only local-agent tools that let the AI search and inspect chats belonging to the current app:

- **`search_chats`** — FTS5 keyword search over a role-aware, cleaned projection of chat history. It returns ranked chat/message pointers with short excerpts, never complete messages.
- **`read_chat`** — bounded retrieval from a specific same-app chat, either around a message returned by search or as a chronological page. Unlike search, it may read the current chat, which is useful after context compaction.

The intended flow is `search_chats` -> `read_chat({ around_message_id })`: discover the relevant prior discussion cheaply, then retrieve only enough surrounding context to answer accurately.

Search computation and storage stay on-device. However, text returned by either tool becomes part of the active model request and may therefore be sent to the user's selected cloud model provider. The product and consent UI must describe this as **local retrieval**, not end-to-end offline processing.

## Goals

- Recall decisions, requirements, failures, and prior work discussed in chats for the same app.
- Keep tool results small and source-attributed.
- Work in local-agent, Ask, Plan, and free-model modes.
- Preserve a hard same-app authorization boundary.
- Avoid indexing bulky generated payloads, thinking, or recursively retrieved chat history.
- Remain responsive and complete for apps with large chat histories.
- Make it visible to the user which historical chats the agent consulted.

## Non-goals

- Semantic/vector search.
- Cross-app chat access, including via `@app:` references.
- Searching `aiMessagesJson` or exposing native tool-call transcripts.
- Returning an entire chat in one call.
- Replacing the existing user-facing chat search dialog in this PR.

## Design decisions

### 1. Use SQLite FTS5 now

Use a local FTS5 virtual table and SQLite's built-in `bm25()` ranking. Do not add an in-process BM25 pass or generalize `tools/bm25.ts`; that ranker remains specific to MCP tool discovery.

FTS5 removes the correctness problem of taking the newest N raw `LIKE` matches before ranking. An old, specific result must remain discoverable even when thousands of recent messages contain common query words.

Before implementation, verify that the packaged `better-sqlite3` binaries used on macOS, Windows, and Linux have FTS5 enabled. Add an automated capability test that creates and queries a temporary FTS5 table. FTS5 is a hard requirement for this feature; do not silently fall back to raw `LIKE` search with different relevance behavior.

### 2. Keep search and read as separate tools

This follows the existing `grep` -> `read_file` pattern:

- Search returns bounded pointers and excerpts.
- Read deliberately expands one pointer.
- `read_chat` accepts `around_message_id`, so the model never has to page blindly from the start of a long conversation.

### 3. Search a role-aware projection, not raw stored content

`messages.content` is the source of user-visible chat data, but assistant messages can contain full files, SQL, diffs, logs, schemas, and tool results inside Dyad tags. Build and index a deterministic projection designed specifically for chat recall.

Never select or index `aiMessagesJson`. It is an internal, potentially multi-megabyte duplicate representation.

### 4. Treat cross-chat access as a data-disclosure boundary

Both tools use `defaultConsent: "ask"`. The consent preview must say that historical chat text from the current app will be provided to the active AI model. Users who want seamless recall can choose "Always allow" through the existing agent-tool permission UI.

Both tools have no `modifiesState` flag and no `usesEngineEndpoint`. Their `execute()` implementations must perform only reads. FTS maintenance runs independently as application-owned derived-index maintenance; a tool call must not lazily write or rebuild the index.

### 5. Enforce current-app scope in the main process

- Derive the app from `ctx.appId`; there is no `app_id` tool argument.
- `search_chats` excludes `ctx.chatId` by default to avoid self-matches.
- `read_chat` allows the current chat as well as other chats for the same app. Earlier current-chat messages may no longer be in the model context after compaction.
- Every read query must enforce the app relationship in SQL, not load by chat/message ID and validate only afterward.
- Missing and cross-app chat/message IDs both produce `DyadErrorKind.NotFound`, avoiding cross-app existence disclosure.

## Data model and FTS lifecycle

### 1. FTS table

Create a standalone FTS5 virtual table conceptually shaped as:

```sql
CREATE VIRTUAL TABLE chat_search_fts USING fts5(
  title,
  body,
  app_id UNINDEXED,
  chat_id UNINDEXED,
  message_id UNINDEXED,
  role UNINDEXED,
  message_created_at UNINDEXED,
  is_compaction_summary UNINDEXED,
  projection_truncated UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Use `message_id` as the FTS rowid so each source message has at most one indexed document. Store only the cleaned projection, never raw content.

The exact migration may add small ordinary tables for dirty-message IDs, dirty-chat IDs, and the projection version. Model ordinary tables in `src/db/schema.ts` and generate their migration normally. Since Drizzle schema declarations cannot express this FTS virtual table and its triggers, generate a custom migration scaffold with:

```sh
npm run db:generate -- --custom --name chat-search-fts
```

Then add the FTS/triggers SQL to that generated file. Do not create or number a migration file manually. Follow `rules/database-drizzle.md`, including regeneration after rebases that change migration numbering.

### 2. Dirty queues and synchronization

FTS rows contain a TypeScript-produced projection, so SQLite triggers cannot fully construct them. Use triggers only to track source changes:

- Message insert or relevant update (`content`, `role`, `is_compaction_summary`) upserts its ID into a dirty-message table.
- Message delete removes its FTS row and dirty entry.
- Chat-title update records the chat ID so indexed documents for that chat receive the new title.
- Chat/message cascades must remove corresponding FTS and dirty rows.
- The migration initially marks all existing messages dirty for backfill.

Add a background `ChatSearchIndexer` service owned by the main process:

- Start it after database migration and stop it during shutdown.
- Drain dirty rows in small batches and yield between batches so it does not monopolize Electron's main process.
- Re-query each dirty message joined to its chat, build its projection, then transactionally replace the FTS row and clear the dirty marker.
- Re-index affected message rows when a chat title changes.
- Store a `CHAT_SEARCH_PROJECTION_VERSION`. When the projection policy changes, mark existing documents dirty and rebuild them in the background.
- Schedule indexing after startup and after settled chat-message writes. A low-frequency dirty-queue poll provides repair coverage for less common mutation paths.
- Expose an in-memory per-app progress promise/state so search can briefly await an already-running batch without initiating writes itself.

`search_chats.execute()` remains a pure read. If indexing does not become current within a short bounded wait, return results from the current index with structured coverage metadata such as `index_status: "indexing"`. Do not block an agent turn indefinitely.

### 3. Consistency expectations

- Newly completed messages should normally be searchable by the next turn.
- Streaming assistant placeholders must not be repeatedly projected on every chunk; index after settlement. Dirty-row deduplication prevents repeated source updates from growing the queue.
- Deleted messages/chats must disappear promptly via database triggers.
- Search results must disclose when backfill or repair is still in progress.

## Searchable projection

Add `src/pro/main/ipc/handlers/local_agent/tools/chat_search_text.ts` with a role-aware API:

```ts
interface ChatSearchProjectionInput {
  role: "user" | "assistant";
  content: string;
  isCompactionSummary: boolean;
}

interface ChatSearchProjection {
  text: string;
  truncated: boolean;
}

function projectChatMessageForSearch(
  input: ChatSearchProjectionInput,
): ChatSearchProjection;
```

### User messages

Preserve user-authored text. Do not interpret literal `<dyad-*>` examples in user messages as trusted tool markup. Apply only normalization and a generous pathological-size bound.

### Assistant messages

Use the existing structured streaming-message parser where practical rather than a generic `<dyad-*>...</dyad-*>` regex. Apply an explicit policy by block/tag class:

- Preserve ordinary assistant prose.
- Drop `<think>` bodies.
- Preserve compaction-summary text, chat summaries, plans, blueprint decisions, questionnaires/answers, security findings, status text, and concise error summaries.
- For file writes, search-replace operations, generated tests, renames, copies, deletes, dependencies, and commands, retain concise metadata such as paths, package names, operation type, and description; omit file/code bodies.
- For SQL, logs, grep/code-search output, Git diffs, schemas, web payloads, MCP results, scripts, and similar bulky tool output, omit the body while retaining safe concise metadata where useful.
- Drop the bodies of `dyad-search-chats` and `dyad-read-chat` so retrieved history never becomes recursively searchable copied history.
- For a newly introduced recognized Dyad tag without an explicit policy, fail closed by omitting its body and keeping only allowlisted short attributes. Add a test whenever a new tag becomes intentionally searchable.

Compaction summaries require explicit handling: the `<dyad-compaction>` body is high-signal searchable text. Original messages remain in the database, so post-ranking grouping should avoid returning a compaction-summary excerpt that merely duplicates a stronger original-message hit. Apply a small score penalty to summary rows while still allowing them to surface unique terms.

Normalize whitespace and cap pathological projections to a documented byte limit, preserving a head and tail segment and recording `truncated`. Normal chat messages should not hit this bound after payload removal.

## `search_chats` tool

**New file:** `src/pro/main/ipc/handlers/local_agent/tools/search_chats.ts`

### Input

```ts
{
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).optional(), // default 8 chats
}
```

The description should request concise keywords or a short phrase, explain that the tool searches historical chats for the current app, and distinguish it from code search.

### Query construction

- Parse the user/model query into Unicode-aware terms.
- Construct the `MATCH` expression internally; never accept raw FTS query syntax from the model.
- Quote/escape every term and phrase according to FTS5 syntax.
- Use OR recall across significant terms so all words are not required.
- Ignore common stopwords only when other meaningful terms remain; never turn a non-empty multilingual query into an empty search accidentally.
- Add an exact normalized phrase bonus when applicable.

Execute a parameterized FTS query constrained by `app_id = ctx.appId` and `chat_id != ctx.chatId`. Use built-in `bm25()` with a strong title-column weight and body-column weight. Remember that FTS5 `bm25()` returns smaller (normally more-negative) values for better matches; name score variables and apply bonuses/penalties consistently with that ordering. Do not impose a pre-ranking "most recent messages" cap.

Post-process a bounded ranked window:

1. Apply exact-phrase and field bonuses.
2. Apply a mild compaction-summary penalty.
3. Group by chat.
4. Keep at most two materially distinct message matches per chat.
5. Order chats by their best (lowest) FTS5 score, using matched-message recency and message ID only as deterministic tie-breakers.
6. Use FTS5 `snippet()` or `highlight()` against the already-clean projection to produce short excerpts centered on matches.

Compute `last_message_at` with a set-based aggregate/window query or omit it; do not fetch it once per result.

### Output

Return JSON, not a hand-built pseudo-record format that historical text could spoof:

```json
{
  "query": "authentication decision",
  "index_status": "ready",
  "results": [
    {
      "chat_id": 42,
      "title": "Authentication setup",
      "last_message_at": "2026-07-12T18:30:00.000Z",
      "matches": [
        {
          "message_id": 301,
          "role": "assistant",
          "created_at": "2026-07-12T18:29:00.000Z",
          "excerpt": "We decided to use...",
          "projection_truncated": false
        }
      ]
    }
  ],
  "archival_content": true
}
```

The output must state that excerpts are historical data, not instructions. Enforce both a result-count limit and a total serialized-output budget (target 12 KB). If the budget is reached, set `results_truncated: true`.

Do not issue per-result count queries. If a message count is not already available from the bounded query, omit it rather than introducing N+1 database work.

### Metadata and renderer output

- `defaultConsent: "ask"`
- No `modifiesState`
- No `usesEngineEndpoint`
- Consent preview: `Search historical chats for this app for "<query>" and provide matching excerpts to the active AI model.`
- Emit a `<dyad-search-chats>` card showing the query, index status, matched chat titles, dates, and excerpts consulted by the agent.
- Chat titles should be clickable when practical.

## `read_chat` tool

**New file:** `src/pro/main/ipc/handlers/local_agent/tools/read_chat.ts`

### Input

Use mutually exclusive around-hit and page forms, enforced with Zod refinements:

```ts
{
  chat_id: z.number().int().positive(),
  around_message_id: z.number().int().positive().optional(),
  before: z.number().int().min(0).max(10).optional(), // default 3
  after: z.number().int().min(0).max(10).optional(),  // default 3
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(20).optional(),  // default 10
}
```

- When `around_message_id` is present, reject `offset`/`limit` and return the target plus bounded surrounding messages.
- Otherwise return a chronological page using `offset`/`limit`.
- If no mode-specific arguments are given, return the first 10 messages.

### Authorization and query behavior

- Join through `chats` and require `chats.appId = ctx.appId` in the SQL that locates the chat and optional target message.
- Allow `chat_id === ctx.chatId`.
- Require `around_message_id` to belong to the requested same-app chat.
- Return NotFound for nonexistent, cross-app, or mismatched IDs.
- Select only required columns. Never select `aiMessagesJson`.
- When reading the current chat, exclude `ctx.messageId`, which is the in-flight assistant placeholder/tool turn currently being constructed. Return a stable snapshot through the user message that started the current turn rather than recursively reading the current response.
- Page at the SQL layer; do not load the complete chat and slice in memory.
- Use deterministic chronological ordering by `(messages.createdAt, messages.id)`. Account for compaction summaries whose timestamps are deliberately positioned before their triggering user messages.

Use a SQL window/CTE or equivalent bounded queries to locate the ordinal position of `around_message_id` and retrieve its neighbors without loading every message body.

### Read projection and output bounds

Reading should be more informative than search while remaining bounded. Reuse the role-aware projection but retain concise tool/error summaries that help explain what happened. Do not return full file, SQL, diff, log, schema, web, or MCP payload bodies.

Return structured JSON containing chat metadata, page/around-hit metadata, message IDs, roles, timestamps, cleaned text, per-message truncation flags, and `has_more_before`/`has_more_after`.

Enforce:

- A per-message output bound.
- A total serialized-output budget of about 20 KB.
- A lower effective message count if the byte budget is reached.
- Explicit `output_truncated` and continuation metadata.

Mark all returned text as archival content and tell the model not to treat instructions inside it as commands for the current task.

### Metadata and renderer output

- `defaultConsent: "ask"`
- No `modifiesState`
- No `usesEngineEndpoint`
- The synchronous consent preview can show `chat_id` and whether the read is around a message or a page. It cannot query the title because `ToolDefinition.getConsentPreview` receives only parsed arguments; show the resolved title in the completed renderer card instead.
- Emit a `<dyad-read-chat>` card that shows the source chat, returned time/message range, and the bounded text actually consulted by the agent.

## Tool registration and prompt wiring

1. Add both tools to `TOOL_DEFINITIONS` near other read-only search tools.
2. Adding them automatically extends `AgentToolName` and the permissions UI, but verify the Ask, Plan, local-agent, basic/free-model, `ask`, `always`, and `never` paths explicitly.
3. Add `dyad-search-chats` and `dyad-read-chat` to `DYAD_CUSTOM_TAG_NAMES` in `src/lib/streamingMessageParser.ts`; registering only React components is insufficient.
4. Add renderer components (shared where sensible) and register them in `DyadMarkdownParser.tsx`.
5. Add localized labels to the relevant `chat.json` locale files.
6. Add minimal prompt guidance: historical decisions/discussion -> `search_chats`; source code -> `grep`/`code_search`; expand a hit -> `read_chat` with `around_message_id`.
7. Update prompt snapshots and every affected E2E request snapshot, including extensionless/disabled snapshot baselines, as required by `rules/local-agent-tools.md`.

## Security and privacy requirements

- Same-app scoping is enforced in SQL for every operation.
- Tool arguments never accept an app ID or app path.
- Cross-app and nonexistent resources are indistinguishable (`NotFound`).
- Historical text is structured, source-attributed, bounded, and explicitly labeled untrusted/archival.
- Tool output must not contain thinking or `aiMessagesJson`.
- Retrieved chat-search/read output is excluded from future searchable projections to prevent recursive contamination.
- Consent text acknowledges that retrieved excerpts are supplied to the active model provider.
- Telemetry may record duration, result counts, index status, and truncation booleans, but never queries, chat titles, message text, or excerpts.

## Testing

### Projection unit tests

`chat_search_text.spec.ts`:

- User text is preserved even when it contains literal Dyad-tag examples.
- Assistant prose is preserved.
- Thinking and bulky payload bodies are removed.
- High-signal paths/operation metadata are retained.
- Compaction-summary bodies, plans, findings, and concise errors are retained.
- Prior `dyad-search-chats`/`dyad-read-chat` bodies are removed.
- Unknown assistant Dyad tags fail closed.
- Malformed, incomplete, nested, and escaped tags do not leak payload bodies.
- Pathological projection bounds are deterministic and marked truncated.

### Index and migration tests

- The test SQLite build supports FTS5.
- Fresh migrations create the virtual table, dirty queues, and triggers.
- Existing messages are marked for backfill.
- Insert/update/title-change/delete/cascade flows keep the derived index correct.
- Projection-version changes rebuild affected documents.
- Dirty-row batching yields and resumes without losing work.
- The tool can read a partially built index and reports `index_status` accurately without performing writes.

### `search_chats` tests

- Current-app scoping and current-chat exclusion.
- Cross-app content never appears.
- Old rare matches are not starved by thousands of newer common-word messages.
- Title weighting, exact-phrase boost, compaction-summary penalty, grouping, deduplication, and deterministic ties.
- Unicode, punctuation/file names, stopword-only queries, FTS-special characters, whitespace-only queries, and maximum query length.
- Result JSON cannot be spoofed by title/message text.
- Total output budget and result truncation metadata.
- Recursive search/read result bodies are not matched.
- `ask`, `always`, and `never` consent behavior.

### `read_chat` tests

- Same-app historical chat and current-chat reads both succeed.
- Cross-app, nonexistent, and mismatched chat/message IDs return NotFound.
- `around_message_id` returns the target and correct neighbors.
- Offset pagination, deterministic ordering, and compaction timestamp ordering.
- SQL-level bounds and explicit `has_more_*` metadata.
- Per-message and total-output truncation.
- `aiMessagesJson` is never selected or returned.
- Historical prompt-like text is framed as archival rather than current instructions.

### Integration and renderer tests

- Add a hybrid integration test that invokes `search_chats`, takes a returned `message_id`, then invokes `read_chat` around it through the real local-agent tool loop.
- Verify tool availability in local-agent, Ask, Plan, and free/basic model modes.
- Verify the tool does not become a state-modifying capability in read-only modes.
- Test renderer cards, expansion, escaping, index/truncation states, and chat navigation.
- Regenerate and inspect prompt/request snapshots to ensure tool descriptions and schemas are correct.

### Verification commands

Run focused tests first, then the repository pre-commit workflow:

```sh
npm test -- src/pro/main/ipc/handlers/local_agent/tools/chat_search_text.spec.ts
npm test -- src/pro/main/ipc/handlers/local_agent/tools/search_chats.spec.ts
npm test -- src/pro/main/ipc/handlers/local_agent/tools/read_chat.spec.ts
# focused hybrid integration test command
npm run fmt
npm run lint
npm run ts
```

Use `/dyad:lint` when available. If an E2E test is added or run, execute `npm run build` first.

## Rollout and observability

- Perform index backfill in the background after upgrade; never block application startup on a full corpus rebuild.
- Surface indexing/partial-coverage state in tool output and the renderer card.
- Measure locally and emit content-free telemetry for index duration, search latency, dirty backlog size, result count, and truncation.
- Define performance acceptance targets before implementation (for example, warm searches under 100 ms for a representative large fixture and bounded main-process batch time).
- Add a realistic large-chat-history fixture covering old matches, large payload tags, compaction summaries, and multilingual content.

## Future work

- Reuse the FTS-backed service in the user-facing chat-search dialog after the agent tool has proven its relevance behavior.
- Add semantic retrieval only as an explicit, provider-flexible layer with separate consent and clear data-egress disclosure.
- Consider cross-app chat search only with an explicit referenced-app identity/authorization design; `referencedApps` paths are not sufficient.
