# Auto-update (Squirrel / update-electron-app)

Debugging update failures reported by users, or changing updater/debug-report code.

- The update feed URL shape is `https://api.dyad.sh/v1/update/{stable|beta}/dyad-sh/dyad/<platform>-<arch>/<version>/RELEASES` (built by `update-electron-app` from the `host` set in `src/main.ts`). To check server health, curl that exact shape — a malformed path (e.g. missing the `dyad-sh/dyad/...` segments) gets a 307 redirect to the repo homepage, which looks "up" but is not a valid feed response.
- Windows `Squirrel.FileDownloader.DownloadUrl` stack traces that start at `--- End of stack trace ---` are missing the head line with the real exception (`System.Net.WebException: ...`). Cause: `update-electron-app` logs updater errors at info level, and the warn-filtered bug-report logs drop `[info]`-prefixed lines while keeping unprefixed stack-trace continuation lines. Fixed by an error-level `autoUpdater.on("error")` handler in `src/main.ts`; old reports still show only tails.
- The full .NET inner-exception chain persists across restarts in Squirrel's own log next to `Update.exe`: `%LocalAppData%\dyad\SquirrelSetup.log`. Debug bundles capture its tail via `readUpdaterLogs()` in `src/ipc/handlers/debug_handlers.ts` (`updaterLogs` field).
- Bug-report bodies travel in the GitHub issue-creation URL (`openGitHubIssue` in `HelpDialog.tsx`), so any new log section added there must be tightly size-capped (~1-2k chars) to avoid overlong URLs. When capping updater logs, reserve space for the `Last updater error (this session)` block; blindly taking the tail can keep only Squirrel stack tails and drop the root cause. Do not split updater log sections on arbitrary blank lines because .NET exception text can contain internal blank lines; use known section headers such as `Squirrel*.log (tail):`.
- Session upload bundles are POSTed and can carry larger updater log tails, but every new uploaded debug field must also be rendered in the `HelpDialog` review screen so users can inspect it before submitting.

## Trusted releases

- Auto-update clients must only receive releases accepted by the provenance verifier in `dyad-cloud/apps/api/src/app/v1/update/release_trust.ts`; a GitHub release and its asset digests are not sufficient trust signals by themselves.
- The verifier allowlists the exact SHA-256 of `.github/workflows/release.yml`. Any intentional workflow edit must be coordinated with that allowlist or new releases will fail closed and disappear from update/landing feeds.
- Generate platform provenance from Electron Forge's publishable artifacts under `out/make`, not all of `out`; the latter also contains unpackaged application files that are not release assets.
