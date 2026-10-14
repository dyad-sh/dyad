# Codex subscription

## Architecture and UX

The Subscription section of the model picker connects a ChatGPT account through
browser OAuth (PKCE). Dyad's main process stores its own credentials using
Electron safeStorage, refreshes them, and calls the Codex Responses endpoint
directly. Credentials never cross renderer IPC and are not imported from another
application. An available OS keyring is required; there is no plaintext fallback.

Free Dyad users can connect their ChatGPT subscription without a Dyad Pro key.
Subscription inference has no Dyad usage fees when Pro is off or no Pro key is
configured; the existing Basic Agent quota and free-tier feature limits still
apply. With Pro enabled, Build, Ask, and Plan subscription inference also skips
Dyad credit checks and usage charges, including with an exhausted Dyad balance.
Agent mode retains its existing credit checks and usage charges. The resolved
chat mode controls billing, not the global default mode. Explicit Pro-credit
routing and local/custom-provider billing are unchanged.

Onboarding offers **ChatGPT subscription** in place of the Google shortcut.
Google Gemini remains available through **Other providers**. Successful onboarding
sign-in selects an eligible OpenAI model: ChatGPT tiers other than Plus or Pro
(including an unknown tier) prefer `gpt-5.6-luna`, falling back to the first
catalog model. Plus and Pro preserve an already-eligible selection, otherwise
using the first model in the effective subscription catalog. Selection also
adds the model to Recents and sets Agent as
the selected and default mode, then lets a saved first prompt resume. Free users
connecting from the model picker's Subscription submenu get the same defaults.

This is a transport for Dyad's existing agent, not the Codex CLI's agent loop.
Dyad still owns prompts, tool execution, permissions, file edits, preview and undo.
No extra shell tool is introduced. Existing Dyad tool permissions still apply.
Model availability is ultimately decided by the subscription service, not the API
catalog; unavailable models fail without switching to a paid API automatically.
The ChatGPT model-list request uses `codexClientVersion` from the loaded remote
`/v1/language-model-catalog` response when present. Dyad retains the last
published version seen in the current app session through catalog outages or
responses that omit the field; before any version has been seen, it uses the
pinned `0.155.1` fallback. Removing the field does not revert connected clients
to that fallback: publish a different version to change their requests. If
ChatGPT rejects a published version with HTTP 400, Dyad retries that model-list
request once with `0.155.1`. Dyad refreshes the catalog in the background so
subscription lookup does not wait for it, and refreshes the picker when the
account model list changes. The server should publish a version that ChatGPT
recognizes so newly available models appear without a desktop release.

The picker keeps a single model catalog. Its hover-open Subscription submenu
connects/disconnects ChatGPT and displays account-reported usage windows.
The Subscription entry carries a **New** chip. Its panel opens beside the model
list when either side has room; otherwise it replaces the list with a **Back to
models** action. It displays the ChatGPT tier from `chatgpt_plan_type` inside the
OAuth token's `https://api.openai.com/auth` claim, or **Plan unavailable**.
The tier is refreshed with the credentials and never used to bypass Dyad quotas.
Models present in the effective subscription catalog show a `ChatGPT plan` chip when subscription
usage is selected, with the tooltip `Uses your connected ChatGPT subscription`.
Models outside that catalog require their provider API key for free users, or
continue through Pro credits when Pro is enabled. Cancelled or timed-out
sign-in attempts leave Pro-credit routing available. The picker and backend share
one catalog resolution: a nonempty ChatGPT catalog, then the last successful
ChatGPT catalog for the connection, then the OpenAI models returned by
`getBuiltinLanguageModelCatalog()` with its existing remote/cache/local behavior.
Successful ChatGPT catalogs are cached for one hour; empty/failed lookups retry
after a minute and never overwrite the last success. Authentication errors remain
errors. ChatGPT can reject a fallback model; that rejection is surfaced without
switching to Pro credits. Usage windows refresh separately from turn preflight.

The Pro menu's **Model usage** preference is global across chats (`subscription`
or `pro`). Connecting selects subscription; disconnecting selects Pro credits.
Changing it affects the next turn in the same chat, never an in-flight turn.
While Pro is enabled, gateway-supported providers use Pro inference. Custom
providers retain their own API keys and endpoints, and Ollama/LM Studio remain
local; their usage is reported to Engine for billing. With Pro off, local and
custom requests have no Dyad usage reporting. Legacy per-chat API-key choices
do not override this policy. Auto, Auto Sidekick and Auto Balanced apply subscription
routing after resolving each concrete model. Auto keeps its existing candidate
order across Agent, Build, Ask and Plan. Eligible OpenAI models use the connected
ChatGPT subscription, including auxiliary and subagent calls through the shared
model client. Explicit Pro credits still overrides subscription routing.
Subscription failures never advance to a paid fallback candidate.
HTTP 5xx responses retry twice on the same subscription with cancellable backoff
before surfacing a sanitized error. Successful streams are never replayed.
Engine-owned tool services and opaque server-side model selections retain their
existing routes; the client cannot redirect a model selected inside a remote service.

Browser OAuth success returns a static celebration page with automatic
`dyad://chatgpt-connected` navigation and a manual Open Dyad button. No credentials
are in that link. The app only shows success for a verified pending local
connection. Pricing is explained on the website rather than in the setup or
subscription menu. Fast mode uses a toggle and disconnect has an action icon.
Setup shows a **Free** badge on the ChatGPT subscription option
only once settings and subscription status have loaded and sign-in is not pending.
During browser sign-in, the provider option stays disabled and a separate cancel
button appears beside the waiting status.
Rates below are unchanged. Usage limits show an informational banner, never an automatic payment
source switch.
Account status polls every thirty minutes when idle, immediately when the usage
submenu opens, and every thirty seconds while it remains open. Pending browser
sign-in keeps its short completion-polling interval. Usage endpoint responses
retain their independent one-minute cache.

Subscription replies are labeled `ChatGPT subscription (resolved model)`.
Persisted history retains reasoning and provider metadata when using a
subscription. Existing destination-specific transcript sanitizers still apply.
On HTTP 400 with the structured code `invalid_encrypted_content`, the adapter
retries that HTTP request once without encrypted reasoning items, preserving
visible messages and tool calls/results. It does not restart the agent or tools.
After the retried stream completes successfully, a bounded in-memory cache
remembers hashes of the excluded items for that chat, subscription account,
endpoint, and model. Later requests omit those items while preserving new
reasoning. Original database history stays intact. Restarting Dyad or evicting
old cache entries may require another recovery retry. Live verification of
account and connection switches remains necessary.

## BYO credit preflight

Before durable turn acceptance, Dyad resolves the global source and validates
subscription credentials where applicable, and credits only when Pro is enabled.
Free subscription requests never check Dyad credits or send usage to Engine.
The credit check issues
an opaque, main-only admission for the turn, bound to the checked Dyad key. The
first subscription, local, or custom-provider request consumes it once instead
of repeating the check after acceptance. A fail-open preflight issues the same
admission. It is never serialized or persisted, cannot be copied or reused, and
expires when its turn is cancelled. A mismatched account retires the admission
and requires a fresh check.

Subsequent agent requests and callers without admission fetch the existing
`GET https://api.dyad.sh/v1/user/info` using the Dyad billing key for that request.
These are fresh main-process lookups, not the five-minute UI cache or the UI's
test-build mock balance. Recreating a model client does not recreate admission.

- Positive `totalCredits - usedCredits`: proceed.
- Confirmed exhausted balance (including HTTP 200 with exhausted counts) or HTTP
  402: block before inference and ask the user to add credits.
- HTTP 401/403: block and ask the user to update the Dyad key.
- Timeout (ten seconds), network failure, rate limiting, service errors, or
  invalid response: log a redacted warning and **allow generation**. No retry.
- User cancellation is not an outage; it stops the request.

Agent subscription generation and local/custom-provider generation with Pro
enabled are gated. Build, Ask, and Plan subscription requests bypass both this
check and `/track-usage` reporting by capturing an explicit null billing key.
Existing gateway inference routes are unchanged, and the account display still returns null on lookup failure.
This is an eligibility check, not a reservation: spend may lag, concurrent calls
can pass together, and outages intentionally fail open. Post-generation usage
reporting remains a single attempt with no replay.

## Engine contract: POST /track-usage

Authentication is the user's **Dyad Pro key**, never their ChatGPT token. The UUID
`id` is for correlation only, not idempotency. There is no idempotency header.
Example body (all values are illustrative, not credentials):

```json
{
  "version": 1,
  "id": "f6d2a682-63bd-4e0a-a36a-78be594c3f93",
  "modelProvider": "openai",
  "connection": "subscription",
  "modelId": "gpt-5.6-astra",
  "createdAt": "2026-09-04T00:00:00.000Z",
  "totalTokens": 150,
  "cachedInputTokens": 20,
  "uncachedInputTokens": 80,
  "outputTokens": 50
}
```

The same contract accepts `connection: "local"` for Ollama/LM Studio and
`connection: "byok"` for custom providers, with their actual provider identifiers.
These routes report both streaming and nonstreaming usage. Streaming requests ask
OpenAI-compatible providers to include usage; missing counts are never estimated.
Deploy the paired Engine change accepting these connection values before the client.

Engine validates counts, authenticates the billing account, and attempts one
charge through `dyad/dyad-synthetic-cost-tracking`. On success it responds:

```json
{ "id": "f6d2a682-63bd-4e0a-a36a-78be594c3f93", "chargedUsd": 0.000015 }
```

Engine charges **$0.02 per million total tokens** for model IDs containing
`-luna`, `-mini`, or `-nano`; **$0.10 per million total tokens** for all other
models, including uncatalogued models. Matching uses the resolved model ID, not
the display name. Dyad does not calculate or submit a price.

`totalTokens = cachedInputTokens + uncachedInputTokens + outputTokens`. Cached
input means cache reads; cache creation/write tokens count as uncached input.
Output already includes reasoning: never add reasoning tokens again.

Each completed streamed model step triggers one background reporting attempt.
The billing account is captured when that request starts. A failure or missing
usage never blocks chat, and the stream does not wait for billing to finish.
There are no persisted reports, retries, local charge totals, reconciliation
controls, or startup replay. Old `codex-subscription-usage.json` files are ignored,
not read or replayed. Active request context is kept only in memory and consumed
before sending, preventing duplicate completion callbacks from reporting twice.

Engine makes one synthetic debit attempt per received report and has no usage
table or deduplication. Two separately submitted copies can charge twice; this
is best-effort single-attempt reporting, not exactly-once server processing.

### Remaining limitations and verification

- Network failures, cancellation without final usage, crashes, and shutdown can
  lose charges. This is an accepted trade-off; neither side replays them.
- Client-reported usage is not tamper-proof. Engine checks the balance at report
  time, but this is not an inference reservation or an account-wide spend lock.
- Public native-client OAuth registration/transport follows the OpenCode pattern;
  that is not proof of authorization for a distributed, surcharged commercial
  integration. Confirm provider authorization before release.
- Nonstreaming auxiliary generation is collected from the same subscription stream,
  preserving text, reasoning metadata, tool calls and usage reporting.
- Real subscription inference has **not passed** on the implementation host:
  packaged Electron reports secure storage unavailable before browser sign-in.
  Do not treat mocked parser tests as proof of service compatibility.

## Verification

Unit/component coverage includes source routing, OAuth state/PKCE, secure-storage
refusal, history preservation, real AI SDK SSE parsing against a fake response,
resolved model usage, single-attempt failures, restart/no-replay behavior,
nonblocking stream completion, and normalized usage payloads.

For a real inference smoke, on an interactive machine with an available OS
keyring and a ChatGPT subscription:

```sh
npm run build
DYAD_LIVE_SUBSCRIPTION_SMOKE=1 PLAYWRIGHT_HTML_OPEN=never npm run e2e -- codex_subscription_live.spec.ts
```

Complete the official browser sign-in locally; never paste credentials into logs
or chat. The opt-in test uses real subscription inference through packaged Dyad
and a **stub Engine receipt only**. It checks a file-tool edit, a same-chat
follow-up, model attribution and usage reports; it is not a production charge
test. Browser traces are disabled and the temporary profile's connection is
removed on exit. `DYAD_LIVE_SUBSCRIPTION_MODEL` can select an available model.

Before release, additionally exercise subscription-to-API/Pro switches with
real history, cancellation recovery, read-only modes, preview and undo on the
real subscription, plus a real Engine single-attempt debit test.
