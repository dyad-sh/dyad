# Invalid App Names Plan

## Context

Dyad currently treats an app's display name and filesystem folder name inconsistently. Some flows use the app name directly as a folder path, while app blueprint approval sanitizes the display name into a folder name before renaming.

This matters because macOS, Windows, and POSIX filesystems do not accept the same names. A name that works as display text can be invalid or dangerous as a folder name.

## Current Behavior

### App Blueprint

- `AppBlueprintDataSchema.appName` accepts any string.
- `app-blueprint:edit-field` stores any `appName` string in memory.
- On blueprint approval, `DyadAppBlueprintCard` derives the target folder with `sanitizeAppFolderName(effectiveAppName)`.
- `sanitizeAppFolderName` currently:
  - replaces `< > : " | ? * / \` with `-`
  - collapses whitespace
  - removes ASCII control characters
  - trims whitespace and leading/trailing dashes
  - falls back to `untitled-app` for empty output, `.`, or `..`
- The original display name is still passed to `renameApp` as `appName`.

### Manual Rename

- `renameApp` accepts any display `appName`.
- It validates only `appPath`, and only when the path changes.
- It rejects:
  - absolute new paths
  - `< > : " | ? * / \`
  - ASCII control characters
- It does not reject Windows reserved device names, trailing periods, trailing spaces, `.`, or `..`.

### Create, Copy, Import

- `createApp` uses `params.name` directly as both display name and folder path.
- `copyApp` uses `newAppName` directly as both display name and folder path.
- import-with-copy uses `appName` directly as the destination folder path.
- These flows only check non-empty names and conflicts. They do not share the rename folder validation.

## Invalid Names We Currently Allow

As display names, Dyad currently allows:

- Windows-invalid filename characters: `< > : " / \ | ? *`
- ASCII control characters at the schema/database layer
- Windows reserved device names: `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`
- Names ending in `.` or space, which Windows rejects as filenames
- Special path segments like `.`, `..`, and path-looking names such as `foo/bar`, depending on the flow
- macOS/POSIX-invalid path characters like `/` and NUL where they are not prevalidated

## Recommendation

Use separate concepts:

- **Display name:** user-facing app name, allowed to be expressive.
- **Folder name:** filesystem-safe app directory name, derived from or validated against the display name.

The common path should stay simple: users type a nice app name, Dyad sanitizes it on their behalf, and Dyad creates a safe folder. New folder names should be lowercase slugs. User-entered and blueprint-generated display names should preserve readable/title-case formatting after sanitization, while folder names use lowercase slugs.

Existing apps should not be proactively migrated. Apply the new policy when creating, copying, importing, or renaming apps. One deliberate exception: app blueprint approval always normalizes the folder to the canonical slug, even for legacy folders (e.g. `My App` → `my-app`), so approval has one simple rule.

## Implementation Plan

1. Add a shared app naming utility.
   - Put it in shared code that is safe for renderer and IPC handler imports.
   - Export `sanitizeAppDisplayName(name)`, `slugifyAppFolderName(name)`, `validateAppFolderName(folderName)`, and `sanitizeAppFolderNameInput(folderName)` — a case-preserving safety sanitizer (essentially today's `sanitizeAppFolderName`, extended with the reserved-name/trailing-period/length rules) for user-typed folder names that must not be slugified.
   - `slugifyAppFolderName` should lowercase names and always produce a single filesystem-safe path segment (path separators are stripped, so the output can never contain `/` or `\`).
   - `validateAppFolderName` checks filesystem safety only (invalid characters, control characters, reserved device names, trailing periods/spaces, `.`/`..`, length). It must NOT enforce lowercase-slug format — legacy folders like `My Awesome App` and user-chosen mixed-case folders remain valid.
   - Keep display-name validation minimal: non-empty after sanitization. `sanitizeAppDisplayName` falls back to `Untitled App` when sanitization eats the whole string (mirroring the `untitled-app` folder fallback), so a blank or control-character-only generated name still yields a coherent name/folder pair.

2. Define a cross-platform folder-name policy.
   - Sanitize path separators: `/` and `\`.
   - Sanitize Windows-invalid characters: `< > : " | ? *`.
   - Strip ASCII control characters.
   - Collapse whitespace and punctuation runs to `-`.
   - Trim leading/trailing separators and periods.
   - Unicode: transliterate accented Latin characters to ASCII (café → cafe), e.g. via NFD normalization + combining-mark strip. Keep other Unicode letters/digits (CJK, etc.) as-is so names like `日本語アプリ` remain meaningful, lowercased via `toLowerCase()`.
   - Fall back to `untitled-app` for `.`, `..`, empty names, and names that sanitize to empty.
   - Avoid Windows reserved device names case-insensitively, including extension variants such as `CON.txt`; append `-app` when needed.
   - Enforce an 80-character maximum for the folder-name path segment, trimming trailing separators after truncation and never splitting a surrogate pair (truncate on code points, not UTF-16 code units).
   - Collision handling for derived folder names: lowercasing and punctuation collapsing make collisions likely (`My App!`, `my app`, and `My-App` all become `my-app`). In the derived-folder flows (create, copy, import-with-copy, blueprint approval), auto-suffix on conflict: `my-app-2`, `my-app-3`, … The suffix is applied AFTER the 80-character truncation (shortening the base if needed) so it is never truncated away. Conflict probing must cover both the database (name and resolved path) and the filesystem.

3. Apply the policy at every filesystem-writing app flow.
   - `createApp`: derive a safe lowercase slug folder name from the submitted display name before checking path conflicts and creating files, auto-suffixing on collision. Store the sanitized display name so it mirrors the folder name as much as possible.
   - `copyApp`: same as create. Note: `copyApp` today only checks the database for a display-name conflict and never checks whether the destination directory exists before `copyDir` — with slugs, two distinct display names can map to the same folder and silently merge one app's files into another's directory. Add an explicit destination-existence check (and auto-suffix) like create.
   - import-with-copy: same as create when copying into Dyad apps.
   - `renameApp`: validate the provided `appPath` with the shared validator, and keep accepting arbitrary display `appName`. Validate ONLY when the path changes (keep the existing `pathChanged` guard) — a display-name-only rename passes the existing path back unchanged, and legacy paths must keep working without a de-facto migration. Do not slugify or lowercase a user-typed folder name; accept any folder that passes the safety validator.
   - app blueprint approval: switch to the shared utility and pass both the sanitized display name and slugified folder name to `renameApp`. Approval always normalizes the folder to the canonical slug — including legacy folders whose leaf differs only in case/format (`My App` → `my-app`). On a display-name conflict, auto-suffix the display name (`Todo App` → `Todo App 2`) and continue instead of rolling back to the rename dialog; the dialog remains only for unexpected rename failures. Manual create/copy keep the hard `Conflict` error for display-name collisions, since there the user typed the name and can adjust it.
   - Auto-suffix resolution must happen in the main process, not the renderer. Extend `renameApp` with an opt-in flag (e.g. `autoResolveConflicts: true`, used by blueprint approval) so probe-and-rename runs atomically under the existing `withLock` — a renderer-side probe followed by a rename is a race. The handler returns the final display name and path; the approval card persists the final name back into the blueprint via the existing `edit-field` path (as it already does for dialog overrides) so the blueprint, app row, and agent all agree on the name.
   - Suffix probing (name and path, in `renameApp` and the preview handler) must exclude the app being renamed, so re-approving the same blueprint is a no-op rather than inflating `Todo App 2` → `Todo App 3` on each approval.
   - Suffix ordering: resolve the display-name suffix first, then derive the folder slug from the final (possibly suffixed) display name. If that folder is independently taken (e.g. by a legacy folder), the folder gets its own suffix; a numeric mismatch between name and folder suffixes is acceptable.
   - Conflict checks: compare resolved app paths case-insensitively (macOS and Windows filesystems are case-insensitive by default, and new lowercase folders will coexist with legacy mixed-case folders). The current `renameApp` path-conflict check is a case-sensitive string compare; fix it as part of this work.
   - Add a small preview IPC handler that resolves a display name to its final folder name (slug + collision suffix, probing DB and filesystem) so the renderer can show the exact resulting folder before submit.

4. Decide UX for sanitization.
   - If the folder name differs from the display name, show the resolved folder name where the app path is displayed.
   - For manual rename folder-only, apply `sanitizeAppFolderNameInput` (case-preserving, no slugification) before submitting and keep the resulting field value visible.
   - For create/copy/import/blueprint approval, sanitize-and-continue so generated names like `Food/Drink Planner` do not block the flow — including display-name collisions in blueprint approval, which auto-suffix rather than block.
   - Show the exact resulting folder name before submit via the preview IPC handler (slug + collision suffix), so users are never surprised by the final labels.

5. Improve errors.
   - Throw `DyadError` with `DyadErrorKind.Validation` for invalid folder names.
   - Keep conflict errors as `DyadErrorKind.Conflict`.
   - Avoid raw filesystem errors for expected invalid-name cases.

6. Add focused tests.
   - Unit tests for the shared sanitizer and validator:
     - invalid characters
     - control characters
     - `.`, `..`, empty/whitespace-only names
     - reserved Windows names and extension variants
     - trailing period/space
     - lowercase slug output
     - accent transliteration (`Café Planner` → `cafe-planner`)
     - CJK preserved as-is (`日本語アプリ` stays `日本語アプリ`, not `untitled-app`)
     - 80-character truncation, including a surrogate-pair/emoji at the truncation boundary
     - collision suffixing (`my-app` taken → `my-app-2`), including suffixing near the 80-character limit
     - validator accepts legacy mixed-case/spaced folders (`My Awesome App`)
   - Handler tests for create, copy, import-with-copy, and rename, including:
     - copy into an already-existing destination folder (distinct display names, same slug)
     - display-name-only rename of a legacy app whose folder would fail slug rules
     - case-insensitive path conflicts
     - the preview IPC handler returning the suffixed folder name when the base slug is taken
   - Component/handler test for blueprint approval auto-suffixing the display name on conflict (`Todo App` → `Todo App 2`) instead of opening the rename dialog, and for normalizing a legacy folder to its slug on approval.
   - Idempotency test: approving the same blueprint twice (including a suffixed one) leaves the name and folder unchanged on the second approval.
   - Symbol-only display name (e.g. emoji-only) yields the expressive display name with an `untitled-app` folder (suffixed on collision).
   - E2E coverage for the user-facing path most likely to regress: blueprint approval with a name containing invalid folder characters.

## Implementation Notes

- Template application (`applyAppTemplate`) already had its own folder
  slugification (`allocateNewAppPath` using `shared/slugify.ts`); it counted
  the app's own folder as a collision, so a folder that already matched the
  canonical slug got pointlessly re-suffixed (`lumen-notes-2` →
  `lumen-notes-2-1`). It now delegates to the shared
  `slugifyAppFolderName` + `resolveUniqueFolderName` (with self-exclusion), so
  blueprint approval and template apply agree on the folder and re-applying is
  a no-op. `slugifyAppPath` in `shared/slugify.ts` remains for GitHub
  repo / Vercel project name defaults (those must stay ASCII), and
  `slugifyAppFolderName` adopted its camelCase/acronym splitting so folder
  names and repo-name defaults stay consistent.

## Open Questions

- None. Resolved decisions:
  - Slug collisions auto-suffix after truncation.
  - Accents transliterate to ASCII; CJK is preserved.
  - `validateAppFolderName` enforces filesystem safety only, not slug format; rename validates only when the path changes.
  - Blueprint approval auto-suffixes display-name conflicts (`Todo App 2`) instead of blocking; manual create/copy keep the hard Conflict error.
  - Manual rename folder input is safety-sanitized (case-preserving) via `sanitizeAppFolderNameInput`, never slugified.
  - Blueprint approval always normalizes the folder to the canonical slug, including legacy folders (the one exception to no-migration).
  - Folder-name previews are exact, resolved via a preview IPC handler that accounts for collision suffixes.
  - Suffix resolution is atomic in `renameApp` (opt-in flag, under the app lock), excludes the app being renamed (re-approval is idempotent), and resolves the name suffix before deriving the folder slug from the final name.
  - Empty-after-sanitization display names fall back to `Untitled App`, mirroring the `untitled-app` folder fallback.
