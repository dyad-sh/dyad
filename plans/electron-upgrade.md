# Electron upgrade assessment and rollout plan

Assessment date: October 28, 2026. Baseline: `0e37c59e6`, Electron **40.0.0**, branch `plan/electron-upgrade` in `/Volumes/essd/dyad-electron-upgrade-plan`.

Prepare the networking fix and credential compatibility tests before changing the runtime. Then qualify **Electron 45.1.0** in beta if macOS 13 is an acceptable minimum and the packaging/preload checks pass. Use **latest 43.x as a short bridge** if those changes block a timely supported release, especially if macOS 12 users need a transition period. Latest 44.x is a useful middle option when 45-specific regressions appear. Do not publish every intervening major simply to make the version steps smaller.

This is a planning change; the runtime and application code remain at the baseline. Candidate compatibility and rollback behavior require the builds and tests below.

## Supported targets

Electron supports its latest three stable major lines. As of this assessment those are 43, 44, and 45; 40, 41, and 42 are end of life. The [release schedule](https://releases.electronjs.org/schedule) lists these dates; future end dates are tentative.

| Line | Status and support horizon              | Role for Dyad                                                         |
| ---- | --------------------------------------- | --------------------------------------------------------------------- |
| 40   | Ended July 1, 2026                      | Current baseline; a same-major patch is temporary containment only    |
| 41   | Ended August 24, 2026                   | Diagnostic checkpoint only                                            |
| 42   | Ended October 20, 2026                  | Diagnostic checkpoint only                                            |
| 43   | Supported until January 5, 2027         | Short bridge; retains macOS 12 support                                |
| 44   | Supported until March 2, 2027           | More mature supported target, with macOS and clipboard migration work |
| 45   | Supported until April 27, 2027          | Preferred destination if qualification passes                         |
| 46   | Alpha; stable scheduled January 5, 2027 | Future work, including async secret storage                           |

The [45.1.0 release](https://releases.electronjs.org/release/v45.1.0), published October 27, is marked Latest Stable and bundles Chromium 156.0.8078.49 and Node 24.22.1. [43.8.4](https://releases.electronjs.org/release/v43.8.4) is a concrete bridge candidate. Recheck release metadata before implementation and pin the exact chosen version. Moving npm tags and search snippets can disagree; do not select a version from an indexed snippet alone.

## Confirmation of the previous regressions

### GitHub device authorization

[Issue 3837](https://github.com/dyad-sh/dyad/issues/3837) documents the failure precisely: GitHub returned HTTP 200 with gzip encoding and chunked transfer at `/login/device/code`, but **node-fetch 2.7.0** raised its premature-close error while consuming the body under Electron 43. The same request worked under Electron 40, and raw `https.request` received the complete response under 43. This was a runtime interaction with node-fetch's stream heuristic, rather than evidence that GitHub rejected the request or Chromium `net.fetch` broke.

The [original upgrade PR 3802](https://github.com/dyad-sh/dyad/pull/3802) moved 40.0.0 to 43.0.0 and changed Forge/rebuild and several other dependencies. [PR 3838](https://github.com/dyad-sh/dyad/pull/3838) rolled it back.

The proposed [regression coverage PR 3842](https://github.com/dyad-sh/dyad/pull/3842) is **closed and unmerged**. Its suggested native-fetch fix and gzip/chunked fixture cannot be assumed to exist in main. At the baseline:

- `src/ipc/handlers/github_handlers.ts:2` still imports node-fetch, including the device-code and access-token requests.
- `testing/fake-llm-server/githubHandler.ts` has no gzip device-code response mode, and `e2e-tests/electron_43_regressions.spec.ts` is absent.
- Other main-process consumers also import node-fetch: subscription status, free quotas, uploads, and release-note requests. They need a targeted transport inventory because the same stream failure could affect other compressed responses.

**Required fix:** remove node-fetch 2 from the affected GitHub transport and prove decompression/body consumption in real Electron. Do not assume a newer Electron patch has fixed this historical interaction without reproducing it.

### macOS Keychain identity and secret loss

Issue 3837 and [merged PR 3849](https://github.com/dyad-sh/dyad/pull/3849) confirm a pre-ready initialization race. `registerAppHandlers()` starts `reconcileCloudSandboxes()`, which can read encrypted settings before readiness. Electron 40 could cache the default **Chromium Safe Storage** identity then; a post-ready session or Electron 43 used **dyad Safe Storage** instead. Ciphertext remained tied to its original Keychain password. Old settings handling omitted secrets that failed decryption and subsequently persisted their deletion.

Current mitigations are substantial:

- `src/main/settings.ts` preserves locked settings ciphertext across writes, including rebuilt nested containers, and attempts recovery after readiness.
- `src/main/safe_storage_legacy.ts` tries both historical Keychain identities and implements the legacy macOS `v10` scheme. Recovery validates plaintext plausibility and caches lookups.
- [PR 3854](https://github.com/dyad-sh/dyad/pull/3854) corrected the real account names to `dyad Key` and `Chromium Key`; the earlier PR description used incorrect bare account names.
- [PR 3855](https://github.com/dyad-sh/dyad/pull/3855) added the in-process native Keychain reader to avoid routine CLI permission prompts. [PR 3856](https://github.com/dyad-sh/dyad/pull/3856) corrected the E2E fixture identities.

**The startup race remains visible in current code.** The existing recovery makes later cleanup possible; do not remove the compatibility reader when deferring early settings access. Dormant users can skip any bridge release and upgrade directly from an old build.

### Remaining credential and test gaps

1. **Recovery coverage differs by store.** Settings use legacy recovery, but `src/ipc/utils/secret_storage.ts` does not invoke it. That helper serves MCP OAuth state and encrypted MCP headers/env maps; failed decrypt currently falls back to interpreting stored bytes as UTF-8. Map readers reject invalid JSON and report unreadability, but that does not restore authentication. `src/ipc/services/codex_subscription_auth.ts` separately decrypts `codex-subscription.enc`, preserves an unreadable file and reports reconnect guidance, but has no legacy identity recovery. Inventory all consumers and verify preservation plus recovery for each store before claiming the upgrade preserves all integrations.
2. **The two-build test is still a historical reproduction.** `e2e-tests/safe_storage_keychain_identity.spec.ts:446` explicitly expects a pre-fix Electron 43 build to lose the token. Replace this with a successful old-to-candidate upgrade assertion; keep any historical repro clearly separate.
3. **CI does not supply a second build.** The `safe-storage-e2e` job enables the suite but does not set `DYAD_E2E_SAFE_STORAGE_UPGRADE_BUILD`, so the two-build test skips. The first test also expects Electron 40's identity flip; adapt it when the runtime/startup order changes, preserving the actual recovery assertions.
4. **Normal test writes bypass encryption.** `encrypt()` skips safeStorage for `IS_TEST_BUILD`, and the upgrade repro manually restores encrypted bytes. Keep fast fixtures, but require production-mode encrypted writes and signed-build restart tests before release.

## Changelog changes that matter to Dyad

These are upstream changes mapped to concrete code exposure. Items labelled qualification risks are hypotheses to test, rather than reproduced Dyad failures.

| Version boundary | Upstream change                                                                                          | Dyad impact and required check                                                                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 41               | Cookie change causes changed; PDF rendering moves into the frame tree                                    | Exercise preview login/cookie isolation and PDF previews. Do not assume old cookie causes or one WebContents per PDF. [41 notes](https://www.electronjs.org/blog/electron-41-0)                                                                                                                       |
| 42               | Electron binaries download lazily; macOS notifications require signing                                   | Explicitly hydrate Electron before parallel tests/build consumers; cover fresh CI and developer installs. Check real signed notifications separately from unsigned E2E. [42 notes](https://www.electronjs.org/blog/electron-42-0)                                                                     |
| 43               | Dialog defaults, Linux decorations, and image color handling change                                      | Check import/export default folders, Linux custom titlebar/drag controls, and screenshots. Faster startup may expose order-dependent logic. [43 notes](https://www.electronjs.org/blog/electron-43-0)                                                                                                 |
| 44               | macOS 12 and 32-bit distributions removed; clipboard redesigned; net client-certificate behavior changes | Establish OS/architecture policy. `debug_handlers.ts:602` uses removed `clipboard.writeImage`: migrate screenshot-copy fallback and its tests. Qualify corporate TLS and certificate prompts. [44 notes](https://www.electronjs.org/blog/electron-44-0)                                               |
| 45               | Sandboxed preloads lose Node shims/globals; sync safeStorage deprecated                                  | Audit emitted preload bundle, including dependencies, for removed APIs. Current preload imports contracts and schemas. Keep synchronous storage for the first runtime upgrade if needed; budget its separate async migration before 46. [45 notes](https://www.electronjs.org/blog/electron-45-0)     |
| 45               | ASAR descriptors, capture permission semantics, popup isolation, and Windows crash packaging change      | Check packed-file/native/worker behavior; preview permissions and popups; screenshot/recording flows; presence and executable-matched naming of the WER DLL. Some capture/worker changes are backported to current 43/44 patches. [45 release notes](https://releases.electronjs.org/release/v45.0.0) |

Additional qualification risks:

- **Native modules and toolchain:** rebuild `better-sqlite3`, `node-pty`, the Keychain reader, and Forge's other configured native modules per target/architecture. The reader uses Node-API, which reduces ABI coupling, but does not establish packaging or signature correctness. Prior upgrade PR 3802 needed rebuild 4.1.0 and Linux compiler follow-ups; use the current compatibility requirements rather than copying its overrides blindly. Preserve ASAR unpacking, native allowlists, signing cleanup, and security fuses in `forge.config.ts`.
- **Preview/runtime behavior:** Chromium changes can affect localhost cookies, service workers, OAuth popups, HMR/WebSockets, GPU rendering and CDP automation. Cover both iframe and optional WebContentsView previews, including generated apps using authentication. No blanket permission relaxation or disabling sandboxing to make an upgrade pass.
- **App lifecycle:** changed startup performance can expose settings/IPC readiness, duplicate-instance, quit/reopen, deep-link and worker-shutdown races. Exercise the actual Squirrel bootstrap and macOS native lifecycle.
- **Updater and provenance:** validate signed old-to-new updates on both mac architectures and Windows. Newer macOS updater behavior includes streamed/resumable downloads; test the existing feed without assuming new feed features are necessary. Preserve app identity/signing. Any release workflow edit must be coordinated with the workflow-hash allowlist in the cloud provenance verifier (`rules/auto-update.md`).

The [breaking changes index](https://www.electronjs.org/docs/latest/breaking-changes) should be checked again against the final exact patch. Security fixes can backport behavior changes, so a lower major alone does not avoid every migration.

## Good upgrade paths

| Path                                                | When it makes sense                                                                                          | Tradeoff                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Prepare on 40, then ship 45 after beta**          | macOS 13 minimum accepted; 45 preload/packaging checks pass                                                  | Best supported runway and one customer runtime transition; largest combined qualification surface                               |
| **Prepare on 40, ship 43 bridge, then 45**          | Fast recovery to a supported line; retain macOS 12 temporarily; separate secret/network work from 44 changes | Two rollouts and native rebuilds; 43 has only about ten weeks of support left                                                   |
| **Prepare on 40, ship 44, then 45**                 | 45-specific ASAR/preload/automation regression; 44 passes                                                    | More mature target and a longer bridge; still requires clipboard migration and macOS 13                                         |
| **Validate 40 → 41 → 42 → 43 → 44 → 45 internally** | Need to locate the first failing runtime boundary                                                            | Excellent diagnosis; expensive if treated as five public releases. Final artifact must still accept direct 40 → target upgrades |
| **Latest 40 patch while preparations finish**       | An urgent narrowly scoped fix while a supported target is blocked                                            | Contains no major migration, but 40 remains unsupported; set an explicit exit deadline                                          |

The preferred sequence is **small implementation changes plus staged rollout**, not necessarily small public version jumps. A bridge release is optional for migration: current Keychain recovery can in principle handle direct upgrades, but every store must pass the acceptance tests. A 43 bridge is justified by qualification speed or platform policy, not because it eliminates the two old bugs.

For macOS 12, retain a last-compatible signed build and prevent unsupported updates in the feed before shipping 44+. Confirm actual user OS/architecture distribution. Supporting macOS 12 securely after Electron 43 reaches end of life needs a separate product decision; keeping 43 indefinitely is not a supported solution.

## Implementation sequence and acceptance gates

### First change on Electron 40

1. Inventory all node-fetch and safeStorage consumers; record store formats, read/write paths, and first startup access. Add a genuine gzip/chunked GitHub response mode to the fake service and a packaged-Electron auth regression. Cover device code, pending poll, success, error, cancel, and reconnect. Reuse existing broad GitHub publish/import journeys.
2. Choose a specific GitHub transport. **Node global fetch** is the narrow replacement for node-fetch and keeps the Node networking stack. **Electron net.fetch** is attractive for system trust/proxy behavior, but introduces Chromium session/cookie/cache and readiness semantics. Prove authorization headers, explicit cookie omission, redirects, cancellation, body reading, errors and fresh repository/collaborator results for the choice. Browser/node-fetch FormData and stream APIs are not interchangeable.
3. Audit node-fetch consumers outside GitHub, particularly upload streaming and multipart behavior, and migrate in separate bounded changes where needed. Do not switch every provider's transport as an incidental effect of the Electron bump.
4. Add preservation/recovery to uncovered credential stores as needed, with tests for unreadable-state edits. Centralize the legacy recovery seam where feasible; preserve each store's deliberate deletion/replacement semantics. Do not decode encrypted bytes as usable credentials after a decryption failure.
5. Replace the old-to-new failing repro with a passing upgrade contract. Test both legacy identities, mixed identities across stores, unrelated settings edits, repeated restarts, replacement, explicit disconnect, and Keychain unavailable/denied/unlock cases. Defer the pre-ready reconciliation in a distinct reviewed change once recovery passes; audit all other early reads too.

**Gate:** the prepared 40 build retains all stored ciphertext, continues normal auth, and provides reusable fixtures for direct upgrade and downgrade. It can be shipped first if a public bridge is useful, but newer builds must support users who skip it.

The [Electron net documentation](https://www.electronjs.org/docs/latest/api/net) distinguishes Chromium networking from Node global fetch and requires readiness. A recent Dyad example is [PR 4933](https://github.com/dyad-sh/dyad/pull/4933): Node fetch failed a customer's Windows self-hosted GitLab TLS chain while net.fetch reached the same server. This supports intentional transport selection; it does not prove that Node fetch caused the old GitHub stream bug.

### Runtime and packaging change

1. Pin the candidate Electron and minimum compatible Forge/rebuild changes. Leave unrelated dependency refreshes out. Check exact Node/V8/native support; retain project Node 24 rather than changing the developer Node major as part of this upgrade.
2. Restore deterministic binary hydration for fresh installs and all test entrypoints that need Electron. Keep Vitest last in `npm test` so targeted arguments still work.
3. Rebuild/package on the existing release matrix: Windows, Linux, macOS Intel, and Apple Silicon. Load each native module from the artifact, open/write SQLite, exercise PTY spawn/output/resize/exit, and recover a legacy Keychain item in the signed macOS artifact.
4. For 44+, migrate screenshot clipboard use and establish the minimum-OS feed behavior. For 45, inspect bundled preload dependencies and exercise first window IPC, events, app preview, and packaged workers. Add only compatibility changes the candidate requires.

**Gate:** format, lint, `npm run ts`, relevant unit/integration suites, fresh `npm run build`, and packaged E2E all pass. Build before each E2E run after application/runtime changes. Run a full qualification suite once the focused regressions pass; ordinary mocked-Electron tests alone cannot establish compatibility.

### Credentials and upgrade matrix

Run the Keychain-swapping suite only on an ephemeral hosted macOS runner or disposable VM. It changes the account-global default Keychain; do not run it casually on the developer/shared release host.

| Scenario                                                          | Required outcome                                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Existing 40 profile with Chromium identity → candidate            | All recoverable settings, provider keys, MCP secrets, and subscription credentials remain usable after launch, write, and restart |
| Existing dyad identity or mixed-store identities → candidate      | Same outcome; no reliance on one global identity assumption                                                                       |
| Fresh candidate install → repeated restart                        | Production-encrypted writes decrypt consistently without recovery dependence                                                      |
| Locked/missing/denied Keychain → unrelated edits → unlock         | No ciphertext loss or silent credential replacement; recover when access returns                                                  |
| Candidate writes new/recovered credentials → prepared 40 rollback | Verify actual backward readability or report locked state with preserved bytes; do not assume reversibility                       |
| Windows DPAPI and Linux keyring profiles → candidate              | Correct restart behavior, unavailable-keyring handling, and preserved unreadable data                                             |

Use synthetic tokens and isolated profiles for automated tests, then signed/notarized builds with real Keychain ACLs for manual qualification. The existing preseeded allow-all ACL fixture cannot prove that production prompts/signature trust behave correctly. Include fresh installs and users upgrading directly from older Dyad versions, not just the latest beta.

### Beta and release

1. Keep one runtime candidate stable during a bounded beta soak, covering normal restart, sleep/wake, provider and MCP connections, GitHub auth/publish/pull, self-hosted GitLab TLS, terminal use, preview auth, and updates. Require multiple real launches and updates before widening. A week is a reasonable starting soak unless a security deadline requires faster release.
2. Compare auth errors, decryption/recovery failures, startup failures, crashes/OOM, updater failures, and support reports against the prior release. Log runtime versions and store/error categories, never secrets. Use per-platform results; an aggregate green macOS run does not clear Windows.
3. Stop promotion for any credential deletion, unrecoverable upgrade-only auth loss, startup/native crash, or failed supported-platform update. Investigate the first failing major internally if a candidate fails.
4. Promote only the qualified artifact through the existing trusted release process. Prepare a higher-Dyad-version fallback build on the last qualified runtime; updater version ordering means publishing an older app version is not a reliable rollback.
5. Retain legacy identity recovery in the fallback and future versions. A binary rollback cannot recreate deleted ciphertext, missing Keychain keys, or older Chromium profile formats. Test profile compatibility and preserve data before promising downgrade support; prefer a forward fix if downgrade is unsafe.

## Follow-up before Electron 46

The [safeStorage API documentation](https://www.electronjs.org/docs/latest/api/safe-storage) announces removal of synchronous methods in 46 and says async decryption can read synchronously encrypted data. Async decryption returns an object containing `result`; storage APIs and initialization must therefore be redesigned deliberately rather than mechanically adding `await` inside today's synchronous `readSettings()` graph.

Keep that migration separate from the initial runtime bump if 45's synchronous APIs suffice. Test legacy identity recovery, write-format compatibility with rollback builds, and platform-specific key providers before rewriting stored ciphertext. New async readability of old data does not establish that old builds can decrypt newly written async data. Preserve the compatibility layer until the old profile population and rollback requirements allow retiring it.

## Decision

Choose **45 after the preparation and qualification gates** when macOS 13 is acceptable. Choose **43 as a time-boxed bridge** if keeping macOS 12 or minimizing immediate compatibility changes is the priority. Choose **44** if 45-specific regressions block release after the shared 44 migrations pass. Use 41/42 and same-major 40 updates for diagnosis or temporary containment only.

The two original regressions are confirmed, and current main still has enough gaps to make a version-only bump premature. The next concrete implementation should be the GitHub transport regression plus successful credential upgrade tests; those benefit every viable target.
