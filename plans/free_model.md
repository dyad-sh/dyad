# Dyad Pro Free Model

## Goal

Add a new Dyad-hosted "free" model for Dyad Pro users with a hard limit of 10 successful user messages per day. The limit is enforced by `../dyad-llm-engine`, while the desktop app shows the user how many free-model messages remain.

This is distinct from the existing Basic Agent quota:

- Basic Agent today is for non-Pro users and is counted locally in the Dyad app.
- The new free model is for Pro users, selected like a model, and counted by the engine so users cannot bypass it by changing local state.

## Product Behavior

1. Pro users see a new model option in the model picker, tentatively named `Dyad Free`.
   - Dyad Pro trial users must not see this model in the picker.
2. Selecting `Dyad Free` keeps the normal chat mode selector available, but in local-agent-backed modes it uses a restricted tool set similar to Basic Agent.
   - Ask and Plan mode are allowed with `Dyad Free`.
3. The UI shows `N/10 remaining today` near the model option and/or the Pro credit chip.
4. When quota reaches 0:
   - `Dyad Free` is disabled or clearly marked unavailable in the picker.
   - Existing chats using `Dyad Free` should prompt the user to switch to another model.
   - The engine still remains the source of truth and returns a quota error if a request slips through.
5. The daily reset is based on server time using a UTC calendar day. Quota resets at `00:00 UTC`.
6. The UI should display the reset time converted to the user's local timezone, e.g. `Resets at 5:00 PM local time`.

## Engine Scope (`../dyad-llm-engine`)

### Model Identity

Introduce a first-class free model identifier, for example:

- Public app model selection: provider `auto`, name `free-pro`
- Engine endpoint: `POST /v1/free/chat/completions`

Avoid reusing the existing app-side `auto/free` OpenRouter fallback semantics. That path is for non-Pro/BYO provider behavior and would blur quota ownership.

The engine should not expose this primarily as another generic model id on `/v1/chat/completions`. The free model has different quota, provider-sharing, and product-policy semantics, so a dedicated route keeps the behavior explicit and avoids coupling the normal model proxy paths to free-model accounting.

### Quota Data Model

Scope engine-owned Postgres tables to a dedicated schema named `dyad_engine`.
Use lowercase snake_case rather than `dyadengine` or `dyadEngine`; this matches
normal Postgres naming conventions and avoids quoted identifiers.

In Drizzle, define the schema with `pgSchema("dyad_engine")` and declare engine
tables from that schema. Existing engine tables should move into this schema as
part of the cutover to the main DB, since existing engine data does not need to
be preserved.

Add a persisted quota ledger table in the `dyad_engine` schema, keyed by authenticated gateway user identity:

- `id`
- `user_id`
- `quota_kind` = `dyad_free_model_daily`
- `quota_date` = UTC date string, e.g. `2026-06-25`
- `used_count`
- `created_at`
- `updated_at`

Add a unique index on `(user_id, quota_kind, quota_date)`.

Implementation should use an atomic database transaction or single upsert/update guard so parallel requests cannot exceed 10. The engine should reserve quota before opening the upstream model stream. If the upstream request fails before a model response starts, refund the reservation. If the user disconnects after generation has started, count the message.

Quota windows are UTC calendar days. Compute `quota_date` and `resetAt` from engine/server time, not client time.

### User Identity

The engine already calls the gateway `/user/info` flow in sandbox/ranker code. Reuse that pattern in a narrow helper:

- Validate the Dyad Pro API key through the gateway.
- Derive a stable `userId`.
- Confirm the user is eligible by checking `user_info.max_budget > 10`.

Do not trust client-sent user ids.

Avoid heuristic entitlement parsing based on fields like `is_pro`, `subscription.active`, or plan names for this route. The free model eligibility rule is permanent and explicit: the authenticated gateway user must have `max_budget` greater than 10.

Leave a code comment beside the eligibility check:

```ts
// The lowest paid Dyad Pro tier has $13.33 in monthly budget, so max_budget > 10
// includes paid Pro users while filtering out trial users.
```

### Request Handling

Apply quota only on the dedicated free-model route:

`POST /v1/free/chat/completions`

The request body can stay OpenAI chat-completions compatible, but the route should ignore or strictly validate any client-sent `model` field and map server-side to the configured upstream free model.

Do not wire `free-pro` through `/v1/responses` or `/v1/messages` for v1 unless the app has a hard dependency on Responses/Anthropic-specific behavior. Keeping v1 chat-completions-only reduces quota/accounting surface area.

The upstream model sent from the engine to the LLM gateway is `dyad/free`.
This gateway model id is engine-side configuration; the desktop app only knows
about the app-facing `free-pro` model.

The engine must not use the end user's Dyad Pro API key for the upstream
`dyad/free` gateway call. For this code path:

- Use the end user's `Authorization` header only to authenticate them, fetch
  `/user/info`, derive quota identity, and check `max_budget > 10`.
- Use the engine environment variable `DYAD_PRO_SHARED_FREE_API_KEY` as the
  `Authorization` key when calling the LLM gateway for `dyad/free`.
- Fail closed with a server configuration error if `DYAD_PRO_SHARED_FREE_API_KEY`
  is missing.

Quota counts one user-visible submitted message. Internal follow-up passes,
retry continuations, todo reminders, and other same-turn local-agent mechanics
must not consume additional free-model messages.

Quota error response should be machine-readable and consistent across routes:

```json
{
  "error": {
    "type": "dyad_free_model_quota_exceeded",
    "message": "Dyad Free has reached its daily limit.",
    "limit": 10,
    "remaining": 0,
    "resetAt": "2026-06-26T00:00:00.000Z"
  }
}
```

Use HTTP `429`.

### Status Endpoint

Add a lightweight authenticated endpoint:

`GET /v1/free/quota`

Response:

```json
{
  "used": 3,
  "limit": 10,
  "remaining": 7,
  "resetAt": "2026-06-26T00:00:00.000Z"
}
```

The desktop app should poll/cache this like `get-user-budget`.

### Engine Tests

Add tests for:

- First request creates the quota row and decrements remaining.
- Ten successful requests are allowed; the eleventh returns `429`.
- Parallel requests cannot exceed 10.
- Requests to normal model routes do not touch the free-model quota.
- Failed pre-stream upstream calls refund quota.
- Status endpoint returns the expected `remaining` and `resetAt`.

## Dyad App Scope

### Model Catalog

Add a new catalog model under the `auto` provider or another Dyad-owned provider row:

- `apiName`: `free-pro`
- `displayName`: `Dyad Free`
- `description`: `10 messages/day included with Dyad Pro`
- `dollarSigns`: `0`
- `tag`: `Free`

Update both:

- Remote catalog expectation/fallback in `src/ipc/shared/remote_language_model_catalog.ts`
- Picker filtering in `src/components/ModelPicker.tsx`

The current picker hides `auto/free` for Pro users. Keep that behavior for the old free model, but allow the new Pro free model.

Do not show `free-pro` to Dyad Pro trial users. The app can use the existing `useTrialModelRestriction()` / `useUserBudgetInfo()` signal (`userBudget.isTrial`) to filter the model before rendering. The engine-side `max_budget > 10` eligibility check remains the source-of-truth backstop if a trial client still sends a request.

### Engine Model Routing

Update `src/ipc/utils/get_model_client.ts` / `src/ipc/utils/llm_engine_provider.ts` so the selected free Pro model routes to the dedicated engine endpoint `POST /v1/free/chat/completions`.

Important details:

- Continue requiring `enableDyadPro` and the Dyad Pro API key.
- Keep the model on the Dyad engine, not BYO OpenRouter fallback.
- Do not send free-pro turns through generic `/v1/chat/completions`, `/v1/responses`, or `/v1/messages` in v1.
- Return a recognizable `builtinProviderId` or add an explicit flag so downstream local-agent code can detect "this turn uses the free model."

### Free Model Quota IPC

Add a new IPC contract rather than overloading `free_agent_quota`:

- `src/ipc/types/free_model_quota.ts`
- `src/ipc/handlers/free_model_quota_handlers.ts`
- hook: `src/hooks/useFreeModelQuota.ts`
- query key: `queryKeys.freeModelQuota.status`

The handler calls the engine status endpoint with the Dyad Pro API key and returns:

- `messagesUsed`
- `messagesLimit`
- `messagesRemaining`
- `isQuotaExceeded`
- `resetTime`

Keep the existing `free_agent_quota` name for Basic Agent only.

### UI

Model picker:

- Show `Dyad Free` to Pro users.
- Do not show `Dyad Free` to Dyad Pro trial users.
- Show `7/10 remaining today` in the row.
- Show a visible `Data sharing` chip directly in the row, not only in the description or tooltip.
- The `Data sharing` chip should have a tooltip: `Data may be shared with the AI provider and used for training models.`
- Disable selection when remaining is 0, unless it is currently selected; if currently selected, show a warning row and guide the user to choose another model.

Title bar / Pro credit display:

- Consider adding the free-model quota to the existing Pro tooltip rather than making another persistent chip. Example: `Dyad Free: 7 of 10 messages remaining today`.

Chat errors:

- Extend `ChatErrorBox` to recognize `dyad_free_model_quota_exceeded`.
- Message should say the daily free-model limit is reached and suggest switching models, not upgrading to Pro, because the user is already Pro.

React Query:

- Invalidate `freeModelQuota.status` after a successful `Dyad Free` stream.
- Refetch on app focus and every 5-30 minutes so reset state updates.

### Tool Restrictions

The new free model should not use tools that call other engine endpoints, such as:

- `web_search`
- `web_fetch`
- `web_crawl`
- `generate_image`
- any future tool implemented through `engineFetch(...)`

It may use local/read-code and MCP consent flows:

- `explore_code`
- `grep`
- `read_file`
- `list_files`
- `search_mcp_tools`
- `get_mcp_tool_schema`
- MCP auto-approve classifier. It may still use the engine separately, but it does not count as an additional free-model user message.

Implementation approach:

1. Add a new `freeModelMode?: boolean` option to `BuildAgentToolSetOptions`.
2. Add a set like `ENGINE_ENDPOINT_TOOLS = new Set(["web_search", "web_fetch", "web_crawl", "generate_image"])`.
3. In `shouldIncludeTool`, skip those tools when `freeModelMode` is true.
4. Pass `freeModelMode` from `handleLocalAgentStream` based on selected model identity, not chat mode.

Do not reuse `basicAgentMode` for this. Basic Agent means non-Pro plus quota; free-model mode means Pro plus selected model.

### Prompts

Update local-agent prompt generation to avoid advertising unavailable tools when the selected model is `Dyad Free`.

If no prompt text changes are needed because tool descriptions are derived only from the registered tool set, still add/adjust tests proving engine-backed tools are absent from the request snapshot.

### Streaming and Quota Invalidation

On successful completion of a `Dyad Free` request:

- Invalidate `queryKeys.freeModelQuota.status`.
- Also invalidate when the engine returns a quota error, so the UI catches up.

Do not decrement quota optimistically in the app. The engine is the source of truth.

## Rollout Plan

1. Engine: add quota table, status endpoint, `/v1/free/chat/completions`, quota middleware/helper, and tests.
2. App: add quota IPC/hook/query key, model catalog entry, model picker UI, and engine routing.
3. App: add `freeModelMode` tool filtering and request/prompt snapshot coverage.
4. App: add quota error handling and query invalidation after streams.
5. E2E: cover Pro user selecting `Dyad Free`, seeing remaining count, sending a successful agent message with allowed local tools, and seeing quota-exceeded behavior at 0 remaining.
6. Release behind a remote catalog flag or engine feature flag first, then expose broadly once quota accounting is verified in production logs.

## Files Likely Touched

Dyad app:

- `src/components/ModelPicker.tsx`
- `src/ipc/utils/get_model_client.ts`
- `src/ipc/utils/llm_engine_provider.ts`
- `src/ipc/shared/remote_language_model_catalog.ts`
- `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts`
- `src/pro/main/ipc/handlers/local_agent/tool_definitions.ts`
- `src/components/chat/ChatErrorBox.tsx`
- `src/app/TitleBar.tsx`
- `src/lib/queryKeys.ts`
- new `src/ipc/types/free_model_quota.ts`
- new `src/ipc/handlers/free_model_quota_handlers.ts`
- new `src/hooks/useFreeModelQuota.ts`

Engine:

- new `../dyad-llm-engine/src/api/free/chatCompletionsRouter.ts` or similar
- add `DYAD_PRO_SHARED_FREE_API_KEY` to engine env config and deployment secrets
- `../dyad-llm-engine/src/db/schema.ts`
- update existing engine table declarations to use `pgSchema("dyad_engine")`
- new quota service/helper under `../dyad-llm-engine/src/api/freeModelQuota/` or similar
- new Drizzle migration
- route registration in `../dyad-llm-engine/src/server.ts`
