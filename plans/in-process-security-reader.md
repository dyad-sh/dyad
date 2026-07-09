# In-process Keychain reader for safeStorage recovery (`SecItemCopyMatching`)

Follow-up #2 from PR #3849 (issue #3837). Replaces the `security` CLI reader used
by legacy safeStorage recovery with an in-process call into the macOS Security
framework, so recovery is silent instead of potentially raising a Keychain
permission prompt (likely the password-entry variant) on a frozen main process.

## Context — read this before touching code

### How recovery works today (PR #3849)

On macOS, Electron `safeStorage` ciphertext ("v10"-prefixed) can become
undecryptable when the Keychain identity a session resolves flips between
"dyad Safe Storage" (post-`ready`) and "Chromium Safe Storage" (pre-`ready`
race on Electron 40). `src/main/safe_storage_legacy.ts` recovers such secrets
by reading the Keychain password of both identities itself and running
Chromium's frozen os_crypt scheme (PBKDF2-HMAC-SHA1 · "saltysalt" · 1003
iterations → AES-128-CBC, IV = 16 spaces, PKCS#7).

The module was deliberately layered so this project only swaps one seam:

- `KeychainPasswordReader` (interface): `readPassword(service, account):
string | null`. **Synchronous. Never throws. Never shows UI. Returns null on
  any failure.** All crypto, identity fallback order, plausibility checking,
  per-ciphertext caching, stats, and the `DYAD_DISABLE_SAFE_STORAGE_RECOVERY`
  kill switch live in `recoverLegacySafeStorageSecret()` and must NOT change.
- `SecurityCliKeychainPasswordReader` (current v1 impl): shells out to
  `security find-generic-password -s <service> -a <account> -w` with a 5s
  timeout, caches results per identity **including null misses** (a profile
  with several locked secrets must not shell out per secret), takes an
  optional explicit keychain path (tests only; production uses the default
  search list).
- The default reader is instantiated lazily in
  `recoverLegacySafeStorageSecret()` (`defaultReader ??= new
SecurityCliKeychainPasswordReader()`).

Identities queried, in order (see `LEGACY_IDENTITIES`):

| service                 | account    |
| ----------------------- | ---------- |
| `dyad Safe Storage`     | `dyad`     |
| `Chromium Safe Storage` | `Chromium` |

### Why the CLI reader prompts and the in-process reader shouldn't

Keychain item ACLs are per-application. Both Safe Storage items on an affected
user's machine were created **by the Dyad binary itself** (safeStorage created
the "Chromium"-named item too — the pre-ready race changes the _service name_,
not the creating app). So the signed Dyad binary is the trusted app in both
items' ACLs and can read them silently via `SecItemCopyMatching`. The
`security` CLI is an Apple-signed, different program → outside the ACL → macOS
raises a confirmation dialog, very likely the variant requiring the user's
login-keychain password, while Dyad's main process is blocked in
`execFileSync`.

Corner case to keep in mind: a "Chromium Safe Storage" item created by some
_other_ app (e.g. an unbranded Chromium/Electron dev build) is NOT in Dyad's
ACL. Reading it in-process would prompt unless we suppress UI. Hence the hard
requirement below.

### Hard requirement: silent or nothing

The in-process reader must never show Keychain UI. If access would require
user interaction, it returns null and recovery falls back to Layer 0
preservation (the ciphertext survives on disk; nothing is lost). Two
mechanisms, use both:

1. `SecKeychainSetUserInteractionAllowed(false)` before the query, restore the
   previous value after (query `SecKeychainGetUserInteractionAllowed` first;
   don't blindly set true). This is the reliable switch for file-based
   keychain ACL dialogs.
2. `kSecUseAuthenticationUI = kSecUseAuthenticationUIFail` in the query
   dictionary, which turns would-prompt into `errSecInteractionNotAllowed`.

## Goal / non-goals

**Goal:** a drop-in `KeychainPasswordReader` implementation backed by
`SecItemCopyMatching`, used by default on darwin, with the CLI reader kept as
an escape hatch and for tests.

**Non-goals:** changing recovery logic, identity order, caching semantics, the
kill switch, Layer 0 preservation in `src/main/settings.ts`, or anything about
how recovered secrets are re-encrypted. No Windows/Linux recovery.

## Design

### 1. Native addon (recommended) — small in-repo N-API module

A ~150-line Objective-C/C N-API addon exposing one function:

```
readGenericPassword(service: string, account: string, keychainPath?: string)
  -> string | null
```

- Query dict: `kSecClass = kSecClassGenericPassword`, `kSecAttrService`,
  `kSecAttrAccount`, `kSecReturnData = true`,
  `kSecMatchLimit = kSecMatchLimitOne`,
  `kSecUseAuthenticationUI = kSecUseAuthenticationUIFail`.
- When `keychainPath` is provided (tests): `SecKeychainOpen(path, &ref)` and
  pass `kSecMatchSearchList = [ref]` so the query is scoped to the throwaway
  keychain, mirroring the CLI reader's testability. `SecKeychainOpen` is
  deprecated but fully functional — os_crypt itself depends on the same
  file-based keychain, so this is not a new liability.
- Wrap the query in the `SecKeychainSetUserInteractionAllowed` save/disable/
  restore sequence.
- Error mapping — all of these return `null` (log at debug in the TS wrapper,
  never the service/password): `errSecItemNotFound`,
  `errSecInteractionNotAllowed` (would have prompted, or keychain locked with
  UI suppressed), `errSecAuthFailed`, any other nonzero `OSStatus`.
- Decode the password `CFDataRef` as UTF-8 (Chromium stores a base64-ish ASCII
  random string, so lossy edge cases don't arise in practice). `CFRelease`
  everything; run the query on the calling thread (it's fast and non-blocking
  with UI suppressed — no timeout machinery needed, unlike the CLI).

Why an in-repo addon over the alternatives:

- `@napi-rs/keyring` / `keytar`: no control over UI suppression, no explicit
  keychain-path support for tests, third-party trust surface on a
  security-critical startup path (and keytar is archived).
- `koffi`/FFI: no compile step, but hand-rolled CFDictionary memory management
  in JS risks a segfault in the main process at startup — the exact path we
  are hardening. Keep as fallback if the addon's build integration stalls.
- Bundled same-team-signed helper binary: relies on `teamid:` partition-list
  behavior (unverified), still a child process, and adds signing pipeline
  steps.

The repo already builds native modules (better-sqlite3, node-pty) via forge's
`rebuildConfig`, so the toolchain exists.

### 2. TS wrapper: `InProcessKeychainPasswordReader`

New class in `src/main/safe_storage_legacy.ts` (or a sibling module)
implementing `KeychainPasswordReader`:

- `process.platform !== "darwin"` → null (and never load the addon — lazy
  `require` inside the method/constructor so Windows/Linux never touch it).
- Same per-identity cache **including null results** as the CLI reader —
  copy the `passwordCache` pattern verbatim (or extract a tiny shared
  `CachedKeychainPasswordReader` wrapper; either is fine, don't gold-plate).
- Addon load failure (missing .node, unpacked-path issues) → log once, return
  null forever. Recovery degrades to Layer 0 preservation, never crashes.
- Optional `keychainPath` constructor arg passed through, mirroring the CLI
  reader.

### 3. Reader selection and escape hatches

In `recoverLegacySafeStorageSecret()`:

```
defaultReader ??=
  process.env.DYAD_SAFE_STORAGE_READER === "cli"
    ? new SecurityCliKeychainPasswordReader()
    : new InProcessKeychainPasswordReader();
```

- `DYAD_SAFE_STORAGE_READER=cli` reverts to v1 behavior (support escape hatch
  if the addon misbehaves on some macOS version).
- Decision: **no automatic CLI fallback** when the in-process reader returns
  null. A fallback would reintroduce the prompt we're removing; null means
  "preserve and wait" by design.
- `DYAD_DISABLE_SAFE_STORAGE_RECOVERY=1` still short-circuits everything
  before any reader is constructed (unchanged).
- Keep `SecurityCliKeychainPasswordReader` in the codebase (escape hatch +
  existing integration tests keep running).

### 4. Build & packaging tasks (the risky part — budget time here)

- Addon lives in-repo (e.g. `native/keychain-reader/` with `binding.gyp`),
  built during the existing electron-rebuild step. Use gyp `conditions`
  (`OS=='mac'`) so Windows/Linux builds produce nothing and don't require the
  Security framework. **Verify all three platform CI builds stay green** —
  cross-platform gyp no-op targets are a known annoyance; if it fights back,
  consider a darwin-only `optionalDependencies` local package instead.
- Respect `DYAD_SKIP_NATIVE_REBUILD` (`forge.config.ts:114`) the same way
  existing native modules do.
- asar: the `.node` binary must be loadable at runtime. Follow the node-pty
  pattern — add the addon's directory to `packagerConfig.asar.unpackDir` in
  `forge.config.ts`. Verify by launching the packaged app (`npm run pre:e2e`
  output) and exercising recovery; a `require` that works in dev but not
  packaged is the classic failure here.
- The addon must be signed as part of the bundle — forge's osxSign signs
  nested binaries by default; confirm `codesign -dv` on the packaged `.node`.

## Tests

### Unit (all platforms, mock the addon binding)

- Returns null on non-darwin without loading the addon.
- Caches hits and null misses per identity (one binding call per identity
  regardless of how many locked secrets ask).
- Addon load failure → null, no throw.
- Reader-selection: env var picks CLI vs in-process.

### Integration (darwin, mirror the existing `SecurityCliKeychainPasswordReader` suite in `src/main/safe_storage_legacy.test.ts`)

Against a throwaway keychain file (`security create-keychain`, explicit
`keychainPath`, deleted in `afterAll` — copy the existing suite's setup):

- Reads a stored password (`add-generic-password -A`).
- Null for a missing item.
- End-to-end: `recoverLegacySafeStorageSecret` with this reader recovers a
  ciphertext encrypted with `deriveLegacyOsCryptKey(storedPassword)`.
- **The prompt-suppression test (most important new coverage):** create an
  item WITHOUT `-A` via the `security` CLI — its ACL then trusts the CLI, not
  the test process — and assert the reader returns **null promptly** instead
  of hanging or showing UI. This is the "silent or nothing" contract under
  test. (If this proves flaky on CI runners, keep it but gate on an env var
  and run it in the `safe-storage-e2e` job only.)

### E2E

`e2e-tests/safe_storage_keychain_identity.spec.ts` should pass unchanged: it
pre-seeds both identity items with `-A` (world-readable ACL), which the
in-process reader can read silently from the unsigned e2e build. If the
recovery test fails after the swap, the addon isn't loading from the packaged
app — that's a packaging bug, not a test bug.

### Manual verification on a signed build (release checklist)

Re-run the notarized-build procedure used for the CLI reader (mismatch state:
fresh profile → connect GitHub → quit → relaunch): expect **no prompt at
all**, GitHub still connected, and the
`Recovered ... using a legacy safeStorage Keychain identity.` log line in
`~/Library/Logs/dyad/main.log`. Also verify the `DYAD_SAFE_STORAGE_READER=cli`
escape hatch still exhibits the old behavior.

## Risks / open questions

- **Deprecated APIs**: `SecKeychainOpen` / `SecKeychainSetUserInteractionAllowed`
  are deprecated-but-working; Chromium's os_crypt relies on the same
  file-keychain machinery, so they won't disappear before os_crypt does. Note
  it in a comment; don't engineer around it.
- **Unsigned/dev builds**: an adhoc-signed dev binary isn't in the ACL of
  items created by the signed release build → reads return null (suppressed
  prompt). Acceptable: recovery simply doesn't fire in dev against prod
  items; document in the module comment so nobody debugs it as a regression.
- **Locked login keychain**: returns `errSecInteractionNotAllowed` with UI
  suppressed → null → preservation holds. No hang (this replaces the CLI's 5s
  timeout concern entirely).
- **Per-arch builds**: forge builds per-arch (`dyad-darwin-arm64`); the addon
  compiles per-arch in the same pass. No universal-binary handling needed
  unless the release pipeline changes.

## Rollout

1. Land addon + reader + tests, default ON for darwin (env revert available).
2. Update PR #3849's follow-up list; add the manual signed-build check to the
   release checklist alongside the existing prompt-verification item.
3. After a release with clean recovery telemetry (follow-up #4 wires the
   counters), proceed with deferring `reconcileCloudSandboxes()` past
   `app.whenReady()` and the Electron 43 re-land per the #3849 plan.
