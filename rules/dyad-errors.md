# DyadError and telemetry

Use `DyadError` from `src/errors/dyad_error.ts` when throwing from **main process / IPC handlers** (or code only called from there) for failures that are **not product bugs**: validation, missing entities, auth/setup prerequisites, user refusal, conflicts, rate limits, etc.

## API

- **`DyadErrorKind`** — enum classifying the failure.
- **`new DyadError(message, kind)`** — `error.name` is `"DyadError"`; use `error.kind` for branching.
- **`isDyadError(error)`** — type guard.

## Telemetry (PostHog `$exception`)

`sendTelemetryException` in `src/ipc/utils/telemetry.ts` calls `shouldFilterTelemetryException`, which **does not send** exceptions for:

| Kind            | Use for                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| `Validation`    | Invalid input, limits, malformed URLs, Zod-style client mistakes surfaced as errors |
| `NotFound`      | App/chat/plan/file missing, stale IDs                                               |
| `Auth`          | Not signed in, missing token, GitHub not linked                                     |
| `Precondition`  | Wrong state for the operation (e.g. feature not installed, sandbox/path rules)      |
| `Conflict`      | Duplicates, git working-tree conflicts, push rejected — user/environment fixable    |
| `UserCancelled` | User declined a tool or similar explicit refusal                                    |
| `RateLimited`   | Quota / 429-style limits (also see legacy `RateLimitError` handling)                |

**Always sent** (actionable or unknown): `External`, `Internal`, `Unknown`.

Prefer **`DyadError`** over growing `FILTERED_EXCEPTION_MESSAGES` in `telemetry.ts` when the failure is stable and classified.

## Non-Pro event sampling (renderer)

The renderer PostHog `before_send` (in `src/renderer.tsx`) drops ~90% of events for **non-Pro** users. Any event whose audience is primarily free users (conversion funnels like `promo_click`, upgrade CTAs) must be added to `shouldBypassNonProTelemetrySampling` in `src/lib/posthogTelemetry.ts`, or it will be silently undercounted 10x. Errors, `app:initial-load`, and `sandbox.script.*` already bypass sampling.

Keep cross-source error throttling in renderer `before_send`: PostHog's internal exception rate limiter does not uniformly cover manually captured IPC exceptions or custom error-shaped events. `PostHogErrorDeduper` applies the shared tier-aware policy there and persists only bounded fingerprint hashes and counters, never raw error payloads.

Sampling exemptions and error deduplication serve different purposes. An error-shaped event such as `sandbox.script.failed` can bypass the non-Pro random sampler and still be deduplicated; use `dyad_error_suppressed_count` on the next admitted event when reconstructing its volume.

When changing crash exemptions, inventory `sendTelemetryEvent` emitters instead of relying only on a naming suffix. Most process crashes use `:crash_detected`, but the code-explorer host uses the deliberate `code_explorer:host_crash` crash-loop signal.

## IPC handlers

- **`createTypedHandler` / `createLoggedTypedHandler`** rethrow the original error after telemetry — `DyadError` is preserved.
- **`createLoggedHandler` (`safe_handle.ts`)** rethrows `DyadError` unchanged so the renderer keeps `instanceof DyadError`.
- In broad `catch` blocks that convert unknown failures to `DyadError`, first rethrow existing `DyadError` instances. Otherwise an already-classified error (for example `Precondition` or `External`) can be wrapped as the wrong kind and change telemetry filtering.
- When changing a main-process utility from swallowing/logging failures to throwing `DyadError`, audit non-IPC callers such as `app.whenReady()` startup, deep-link handlers, and consent callbacks. These are outside typed handler boundaries, so wrap best-effort writes or surface an explicit dialog instead of letting an unhandled rejection block `createWindow()` or send a success event.

## Migration

Most IPC/main paths and shared utilities (`git_utils`, Supabase admin, local agent tools, etc.) now use **`DyadError`** with an appropriate kind. Remaining `throw new Error(...)` are usually **dynamic** messages (`throw new Error(err.message || …)`), **multi-line** throws, or **renderer** code where telemetry filtering is less critical.

**Do not** import `DyadError` inside preload (`src/preload.ts`) without verifying the preload bundle; preload continues to use plain `Error` for invalid channels.

**Legacy:** `FILTERED_EXCEPTION_MESSAGES`, `RateLimitError` (429) handling in `telemetry.ts`, and bare `TypeError: fetch failed` (via `isGenericFetchFailedError` in `posthogTelemetry.ts`) remain for plain `Error` paths not yet migrated. Renderer PostHog `before_send` uses `shouldFilterPostHogExceptionEvent` for the same fetch noise from autocapture.

When projecting raw main-process errors into renderer-visible text, treat the projection as a security-sensitive boundary and document the redaction tradeoff: a denylist preserves actionable unknown output but cannot guarantee removal of every identifier. Test known sensitive syntax variants, including authorization headers, identities, common secret/token shapes, quoted and unquoted paths with spaces or embedded delimiter characters, `--flag=/path`, bracketed paths, UNC paths, generic URL schemes, scheme-less/SCP Git remotes, and internal hostnames. Test public remediation URLs, source locations, and common filenames separately so redaction does not erase the guidance users need. Pre-bound both total untrusted text and individual lines before running regex-heavy sanitization, then apply the final length bound after composing prefixes or guidance so the serialized state can never exceed its codec limit. Audit every renderer site for bounded multiline presentation when increasing that limit.

Never treat a diagnostic remaining unchanged after denylist sanitization as proof that it is safe for third-party telemetry. Arbitrary provider/tool errors can still contain prompts, source snippets, customer identifiers, or unknown credentials; emit fixed classification metadata or explicitly allowlisted machine-generated fields instead, and do not bypass an expected failure's `DyadErrorKind` by manually capturing a plain `Error`.

Truncation helpers with a caller-supplied bound must also handle bounds shorter than their truncation notice; never pass a negative slice endpoint through and return a value larger than the requested limit.

## Automation pitfalls

- When auto-inserting `import { DyadError, DyadErrorKind } from "@/errors/dyad_error"`, **never** place it inside another `import { ... }` block — it must be its own import statement or TypeScript fails with “Identifier expected” at the next line.
- Automated line-based migrations must **not** match strings inside **test fixtures** (e.g. template literals that embed sample source code); that can inject imports into fake file content.
