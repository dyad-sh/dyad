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

## IPC handlers

- **`createTypedHandler` / `createLoggedTypedHandler`** rethrow the original error after telemetry — `DyadError` is preserved.
- **`createLoggedHandler` (`safe_handle.ts`)** rethrows `DyadError` unchanged so the renderer keeps `instanceof DyadError`.

## Migration

Most IPC/main paths and shared utilities (`git_utils`, Supabase admin, local agent tools, etc.) now use **`DyadError`** with an appropriate kind. Remaining `throw new Error(...)` are usually **dynamic** messages (`throw new Error(err.message || …)`), **multi-line** throws, or **renderer** code where telemetry filtering is less critical.

**Do not** import `DyadError` inside preload (`src/preload.ts`) without verifying the preload bundle; preload continues to use plain `Error` for invalid channels.

**Legacy:** `FILTERED_EXCEPTION_MESSAGES` and `RateLimitError` (429) handling in `telemetry.ts` remain for any plain `Error` paths not yet migrated.

## Automation pitfalls

- When auto-inserting `import { DyadError, DyadErrorKind } from "@/errors/dyad_error"`, **never** place it inside another `import { ... }` block — it must be its own import statement or TypeScript fails with “Identifier expected” at the next line.
- Automated line-based migrations must **not** match strings inside **test fixtures** (e.g. template literals that embed sample source code); that can inject imports into fake file content.
