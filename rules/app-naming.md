# App naming and folder slugs

Read this when touching app display names, app folder paths, or any flow that
creates/moves an app directory (create, copy, import, rename, blueprint
approval, template apply).

- Display names and folder names are separate concepts. All folder derivation
  and validation lives in `src/shared/app_names.ts` (renderer + main safe);
  DB/filesystem collision suffixing lives in
  `src/ipc/utils/app_name_resolution.ts` (main only). Do NOT introduce a new
  slugifier for app folders — template apply once had its own
  (`allocateNewAppPath`) and the two competing derivations caused pointless
  double folder moves (`lumen-notes-2` → `lumen-notes-2-1`) because the
  allocator counted the app's own folder as a collision.
- `slugifyAppPath` in `src/shared/slugify.ts` is only for GitHub repo /
  Vercel project name defaults (must stay ASCII). App folders use
  `slugifyAppFolderName`, which preserves CJK and transliterates accents.
- Collision probing must exclude the app being renamed (DB row AND its own
  on-disk folder), or re-running the same rename inflates suffixes
  (`Todo App 2` → `Todo App 3`).
- Collision probing is deliberately capped at 1000 candidates to keep a
  pathological database/filesystem state from blocking a user action
  indefinitely. Exhausting the cap must surface a `DyadErrorKind.Conflict`
  with actionable context; auto-suffixing is not an unbounded guarantee.
- A case-only folder rename (`MyApp` → `myapp`) must use `fs.rename`, never
  copy-then-delete: on case-insensitive filesystems (macOS/Windows defaults)
  source and destination are the same physical directory, so the delete step
  destroys the app.
