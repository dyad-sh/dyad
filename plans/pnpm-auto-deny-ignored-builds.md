# Auto-Deny Ignored pnpm Builds

> Drafted 2026-07-08 from an investigation session (verified against pnpm 11.10.0 and 10.33.2)

## Summary

When a user installs a package whose build scripts are not in Dyad's curated allow-list (e.g. `core-js`), pnpm skips the build and — under pnpm 11's `strictDepBuilds: true` default — any later **fresh** `pnpm install` that lacks Dyad's `--config.strictDepBuilds=false` flag fails hard with `ERR_PNPM_IGNORED_BUILDS` (exit 1). Users get stuck on the install screen with no recoverable action, and exported repos fail on Vercel/Netlify/CI.

Fix: after every Dyad-run install, record an explicit `pkg: false` decision in `pnpm-workspace.yaml`'s `allowBuilds` map for each ignored build (outside the Dyad-managed block, with a Dyad marker), commit it, and emit telemetry so frequently-denied-but-legit packages can be promoted to the remote allow-list.

## Problem Statement

### Verified failure mechanics

pnpm 11 defaults `strictDepBuilds` to `true`:

- `pnpm install` with a dependency whose build was ignored → `ERR_PNPM_IGNORED_BUILDS`, **exit 1** — but only when pnpm actually (re)installs packages. An "Already up to date" no-op install exits 0 and never re-evaluates build scripts.
- With `--config.strictDepBuilds=false` (Dyad's `PNPM_INSTALL_POLICY_ARGS`), the same install exits 0 with only a warning box.
- An explicit `pkg: false` entry under `allowBuilds` in `pnpm-workspace.yaml` silences **both** the error and the warning, on pnpm 11.x and 10.x. Build behavior is unchanged (the build was already being skipped).
- `node_modules/.modules.yaml` records **implicitly** ignored builds only: an unlisted package lands in `ignoredBuilds`, but once it is explicitly `false` it drops out. (Detection of auto-deny candidates therefore reads exactly the right set; promotion-time repair cannot rely on `ignoredBuilds` — see Promotion & repair.)
- Flipping an entry `false` → `true` and re-running a plain `pnpm install` does **not** run the previously-skipped build ("Already up to date", no postinstall). Only a fresh install or an explicit `pnpm rebuild <pkg>` executes it; `pnpm rebuild <pkg>` was verified to run the skipped postinstall and exit 0.
- Known pnpm quirk (out of scope): `allowBuilds` name-matching does not work for `file:` dependencies — even `pkg: true` fails a strict install with `ERR_PNPM_IGNORED_BUILDS: pkg@file:...`. Dyad apps use registry deps, so this is noted but unhandled.

### Why users get stuck

1. User asks for a feature; AI runs `<dyad-add-dependency packages="core-js">`. Install succeeds (Dyad passes the policy flags) with an "Ignored build scripts" warning. `node_modules/.modules.yaml` records `ignoredBuilds: ["core-js@3.49.0"]`. Nothing is recorded in the repo.
2. The app now works — until a **fresh install** happens through any path that doesn't carry `--config.strictDepBuilds=false`:
   - **Rebuild** (`restartApp({ removeNodeModules: true })`) on an app with a custom `installCommand` (custom commands run verbatim; `getCommand()` in `app_runtime_service.ts` skips `getPnpmInstallCommand()` entirely).
   - The Capacitor upgrade path (`app_upgrade_handlers.ts:109`, intentionally strict) and component-tagger add (`app_upgrade_utils.ts:132`).
   - **Everything outside Dyad**: Vercel/Netlify deploys of the exported repo, GitHub Actions, the user's own terminal, other editors.
3. In the run flow the command is a single `install && dev` chain, so exit 1 short-circuits: the dev server never starts, no preview URL ever appears, and the preview panel sits forever on the ignored-builds error. Retrying Rebuild fails identically. **Restart** appears to work (no-op install exits 0), which makes the failure look nondeterministic to users.

### Why this matters durably

Once an unlisted-build package is in the lockfile, the repo is poisoned for every standard `pnpm install` consumer. The only official fix (`pnpm approve-builds`) is interactive and unreachable from Dyad's UI. Most Dyad users cannot evaluate "should this package run install scripts" — they just need the app to keep working with the same security posture Dyad already applies (builds skipped unless allow-listed).

## Goals

- A user who installs any package always gets back to a working preview — Rebuild included — with zero new prompts.
- Exported repos install cleanly (`pnpm install`, no special flags) on CI/deploy platforms.
- Preserve the supply-chain posture: never run a build script that isn't on the curated allow-list; never use `dangerouslyAllowAllBuilds`.
- Feed telemetry so the remote allow-list (`https://api.dyad.sh/v1/default-approve-builds.txt`, 1h TTL) can be curated from real-world denial frequency.

## Non-Goals

- An interactive per-package approval UI (possible phase 3; silent-deny + telemetry is the right default).
- Changing which builds actually run today.
- Removing `--config.strictDepBuilds=false` from existing Dyad paths (keep as belt-and-suspenders for the first install, before denials are recorded).

## Design

### 1. Detection: read `.modules.yaml`, don't scrape output

After every Dyad-run pnpm install/add that succeeds, read `node_modules/.modules.yaml` and parse `ignoredBuilds` (array of `name@version` strings; strip versions — `allowBuilds` keys are bare names). This is authoritative and avoids parsing ANSI-laden PTY output. (`pnpm ignored-builds` is a non-interactive fallback but spawning is unnecessary when the file is readable.)

Hook points (all already call or sit next to the allow-builds plumbing in `socket_firewall.ts`):

- `executeAddDependency.ts` → after `runAddDependencyCommand` succeeds
- `app_runtime_service.ts` → after the install phase of a local/docker run (see §5 for the custom-command reactive path)
- `cloud_sandbox_provider.ts` → alongside `commitPnpmAllowBuildsConfigIfChanged`

### 2. Recording: `pkg: false` outside the managed block, with a marker

Write denial entries into the top-level `allowBuilds:` map in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  core-js: false # dyad-auto-denied
  # dyad-default-allow-builds begin
  ...managed block, rewritten from local/remote list...
  # dyad-default-allow-builds end
```

Rules:

- **Never inside the managed block** — `buildAllowBuildsManagedBlock` rewrites it wholesale from the local/remote list on every `ensurePnpmAllowBuildsConfigured` call.
- **Tag each auto-written line** with a trailing `# dyad-auto-denied` comment. This distinguishes Dyad's automatic decision from a human's deliberate `pkg: false`. Critical because `updatePnpmAllowBuildsConfigContentWithSource` filters managed entries that already exist outside the block — without the marker, a later remote-list promotion of that package to `true` would be permanently shadowed by our own auto-denial.
- **Promotion**: when the resolved allow-list (remote or local) contains a package that currently has a `# dyad-auto-denied` entry, remove the denial so the managed `pkg: true` takes effect. Never touch untagged (user-authored) entries. See "Promotion & repair" below for how the skipped build then actually gets run.
- Skip packages already `true` in the resolved allow-list or already present (any value) outside the block. Quote scoped names via the existing `quoteYamlMapKey`.
- Idempotent and append-only per install: new ignores get added; existing entries untouched.

### 2b. Promotion & repair (decided: middle ground)

Editing YAML grants _permission_; it does not run the build. Verified: after a `false` → `true` flip, a plain up-to-date `pnpm install` skips the build entirely, and `.modules.yaml` `ignoredBuilds` cannot be used to detect the gap (explicitly-denied packages are never recorded there). So:

- The promotion pass stays a **pure file transform** (no spawning inside `ensurePnpmAllowBuildsConfigured`), but it **returns the list of promoted package names** it just un-denied.
- Callers that already spawn pnpm (app-run install phase, `executeAddDependency`, cloud sandbox command builder) run a **best-effort `pnpm rebuild <promoted...>`** after their install step — e.g. the run flow conditionally builds the chain as `install && (rebuild <pkgs> || true) && dev`. Rebuild failure must not block the dev server; if the build genuinely mattered, the app is no worse off than before promotion.
- The promoted-names return value is the _only_ trigger — no `.modules.yaml` inspection, no rebuild on ordinary runs. Promotions are rare (only when the curated list changes), so 99.9% of runs add zero work.
- If the same run happened to do a fresh install (which already ran the build), the extra rebuild is redundant but harmless and rare; not worth optimizing away in Phase 1.

#### Lifecycle walkthrough: deny → curate → promote

1. **T0**: user installs `core-js-2` (unlisted, build genuinely needed). Install succeeds under Dyad flags; proactive pass writes `core-js-2: false # dyad-auto-denied` outside the managed block, commits, emits telemetry. App installs cleanly everywhere; if the build was load-bearing the package misbehaves at runtime (status quo today, but now visible in telemetry).
2. **T1**: curation adds `core-js-2` to the remote allow-list (1h TTL, no release needed).
3. **T2**: on each app's next start/add-dependency, the promotion pass deletes the tagged line, the managed rewrite emits `core-js-2: true`, the caller runs best-effort `pnpm rebuild core-js-2`, and the change is committed. The app self-heals with zero user interaction; later deploys/CI fresh-install and build it natively.

Without the promotion pass this lifecycle **deadlocks at T2**: `parseAllowBuildsExistingKeys` filters any managed-list package that already exists outside the block, so Dyad's own T0 denial would shadow the curated `true` forever. The `# dyad-auto-denied` marker is what distinguishes revisable-by-Dyad entries from human decisions.

Ownership semantics for unmanaged entries when the curated list later adds the same package:

| Unmanaged entry at T2                      | Outcome                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `pkg: false # dyad-auto-denied`            | Promoted: line removed, managed `true` takes over, `pnpm rebuild pkg` runs                         |
| `pkg: false` (user-authored)               | Untouched; existing-keys filter keeps `pkg` out of the managed block — the human deny durably wins |
| `pkg: true` (user-authored/approve-builds) | Untouched; filter avoids a managed duplicate; build already allowed                                |

Consistency invariant: promotion runs **before** the managed-block rewrite in the same transform, and the existing-keys filter is the backstop — no state can contain both an outside `false` and a managed `true` for the same key (YAML duplicate keys are parser-dependent; we never emit them).

Caveat (accepted): a manual `pnpm approve-builds` run rewrites `pnpm-workspace.yaml` through a YAML serializer and strips all comments — managed-block markers and `# dyad-auto-denied` tags alike. Existing code already re-appends a fresh managed block when markers vanish; stripped denials simply become user-authored (never promoted, still correct and installable). Telemetry fired at deny time, so curation signal is not lost.

### 3. Commit

Reuse the `commitPnpmAllowBuildsConfigIfChanged` pattern: `gitAdd` + `gitCommit("[dyad] record denied pnpm dependency builds")`. This is what makes the fix travel with exports/deploys.

### 4. Telemetry

Emit one event per install that produced new denials, via the existing main→renderer telemetry channel (`system.onTelemetryEvent` → PostHog): event `pnpm:build-auto-denied`, properties `{ packages: ["core-js@3.49.0"], source: "add-dependency" | "app-run" | "self-heal" | "cloud-sandbox" }`. This is the input signal for curating the remote allow-list.

**Must bypass the non-Pro 10% sampling.** The renderer's `before_send` (`renderer.tsx`) drops ~90% of non-Pro events unless `shouldBypassNonProTelemetrySampling` (`src/lib/posthogTelemetry.ts`) matches. `pnpm:build-auto-denied` matches none of the current bypass rules (not error-shaped, no bypassed prefix), so without an explicit entry the curation signal would shrink 10× and skew toward Pro users' package mix — free users are the volume that curation depends on. Add the event name (or a shared `pnpm:build-` prefix, if a promotion-success event is added later) to the bypass list. Volume is safe to exempt: the event fires at most once per install _that produces new denials_, so it is rare and self-extinguishing (after the first denial is recorded, later installs of the same app emit nothing).

### 5. Reactive self-heal for strict paths

Apps with custom `installCommand` (and the Capacitor flow) hit `ERR_PNPM_IGNORED_BUILDS` **before** any proactive denial exists (fresh `node_modules`, e.g. Rebuild). On install failure:

1. Detect `ERR_PNPM_IGNORED_BUILDS` in the failure output (stable error code string, present even in PTY output).
2. Read the ignored package names from `node_modules/.modules.yaml` — **verified**: pnpm links packages and writes `ignoredBuilds` before erroring, even on the exit-1 failure. Fall back to parsing the error line (`Ignored build scripts: core-js@3.49.0, foo@1.2.3`) only if the file is unreadable; the error line can wrap in narrow PTYs when many packages are listed.
3. Write denials (§2), commit (§3), emit telemetry with `source: "self-heal"`.
4. Retry the install **once**. Verified: explicit `false` entries make strict-default installs exit 0.

This fixes the Rebuild-stuck-forever loop without weakening the intentionally-strict paths.

### 6. Agent visibility

Append a line to the install results written back into the `<dyad-add-dependency>` tag: `Note: build scripts for core-js were not run (Dyad security policy).` If the app later fails at runtime because a denied package genuinely needed its build (native addon → `Cannot find module '.../Release/*.node'`), the AI has the context to explain/react instead of flailing.

## Additional pnpm edge cases (considered)

- **pnpm 10.x compat** — verified: pnpm 10.33 honors `allowBuilds` (both `true` and `false`). Caveat: Dyad's availability probe accepts any pnpm version (the 10.16 check only gates a warning), and pnpm 10 builds older than the `allowBuilds` map would silently ignore the managed block. Low priority; consider a version floor note if support tickets appear.
- **Non-registry deps (`file:`, `git:`)** — verified asymmetry: `pkg: false` matches by bare name and suppresses the strict error, but `pkg: true` does **not** match (strict install fails even when "allowed"). Auto-deny therefore works on them; promotion cannot — acceptable, since the curated list never contains such names. Self-heal must not assume a denied non-registry package is later allowable by name.
- **Transitive deps are the common case** — `ignoredBuilds` reports the whole tree (user installs A, native B arrives transitively). Auto-deny handles this naturally since we deny exactly what `.modules.yaml` reports; telemetry captures packages the user never chose.
- **Stale denials** — if the dep tree later drops a denied package, its `false` entry remains. Inert cruft; garbage collection is a non-goal.
- **`package.json` `pnpm.*` settings in imported apps** (`onlyBuiltDependencies`, `ignoredBuiltDependencies`) — pnpm merges sources; a package ignored at that level never appears in `ignoredBuilds`, so the design is self-consistent. Do not attempt to reconcile.
- **npm fallback runs all build scripts unconditionally** — pre-existing posture when pnpm is unavailable, not a regression; noted as a known inconsistency.
- **Docker mode uses the container's pnpm** — version-dependent behaviors above apply per-environment against the shared workspace YAML.
- **Concurrency** — temp-file + rename write is atomic; restart path holds `withLock(appId)`. Acceptable.
- **Aliased deps (`alias@npm:real`) / user-global `.npmrc`** — deny by the real package name as reported in `ignoredBuilds` (pnpm resolves aliases there); global `strict-dep-builds=false` merely removes the failure mode.

## Risks & Mitigations

| Risk                                                                                                | Mitigation                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package genuinely needs its build; auto-deny converts install-time error into obscure runtime error | No regression vs today (build already skipped by `strictDepBuilds=false`); telemetry → remote-list promotion loop; agent-visible note (§6); optional phase-3 UI ("X was blocked from running install scripts — Allow and rebuild") |
| Denial shadows a future curated promotion                                                           | `# dyad-auto-denied` marker + promotion pass in §2                                                                                                                                                                                 |
| YAML corruption of user-edited workspace files                                                      | Reuse the existing line-based editing + marker approach in `socket_firewall.ts`, extend its unit tests; atomic temp-file write already exists                                                                                      |
| Self-heal retry loops                                                                               | Retry exactly once per install invocation                                                                                                                                                                                          |
| npm-based apps                                                                                      | Unaffected (no `pnpm-workspace.yaml` involvement)                                                                                                                                                                                  |

## Implementation Phases

**Phase 1 — proactive denial (core)**

- `readIgnoredBuilds(appPath)` util (parse `node_modules/.modules.yaml`).
- `recordDeniedBuilds(appPath, packages)` in `socket_firewall.ts`: marker-tagged `false` entries outside the managed block + commit helper.
- Promotion pass inside the allow-builds rewrite; `ensurePnpmAllowBuildsConfigured` returns `{ changed, promotedPackages }`.
- Callers run best-effort `pnpm rebuild <promotedPackages>` after their install step (§2b).
- Wire into `executeAddDependency`, app-run install completion, cloud sandbox.
- Telemetry event, added to `shouldBypassNonProTelemetrySampling` so free-user events are never sampled out (§4); unit test alongside the existing bypass tests.
- Unit tests alongside the existing `socket_firewall` allow-builds tests (marker round-trip, promotion returns promoted names, dedupe vs managed block, scoped-name quoting, user-authored `false` untouched).

**Phase 2 — reactive self-heal**

- `ERR_PNPM_IGNORED_BUILDS` detection on install failure in `app_runtime_service` (custom commands) and upgrade flows; deny + retry once.
- E2E: app with custom `pnpm install` command + unlisted-build dep → Rebuild reaches preview.

**Phase 3 (optional, later)**

- Problems-panel affordance to flip a denial to `true` + `pnpm rebuild`.
- Remote-list curation dashboard fed by the telemetry.

## Resolved Questions

- ~~Should the promotion pass run `pnpm rebuild <pkg>` immediately, or defer to the next fresh install?~~ **Decided: middle ground (§2b).** The YAML pass stays pure and returns promoted names; callers that already spawn pnpm run a best-effort `pnpm rebuild <pkgs>` after install. Verified empirically that neither a plain up-to-date install nor `.modules.yaml` inspection can substitute: the flip alone never runs the build, and explicitly-denied packages are absent from `ignoredBuilds`.
- ~~Should denials recorded during cloud-sandbox installs also be committed locally, or only in the sandbox file map?~~ **Decided: commit locally** (same `commitPnpmAllowBuildsConfigIfChanged`-style flow as the other hook points). The local repo is the source of truth the sandbox file map is built from, so committing locally keeps sandbox restarts and exports consistent.

## Open Questions

- Event naming/property conventions for PostHog — align with existing telemetry taxonomy before Phase 1 lands.
