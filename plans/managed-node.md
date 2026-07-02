# Dyad-managed Node.js runtime

## Problem

Node.js setup is the single largest onboarding failure cluster in the issue tracker (~36 issues). Recurring root causes:

1. **Version managers / non-standard installs invisible to a GUI app** — nvm (#981), fnm (#990), mise (#2171), MINGW64 (#582), broken `~/.local` shims (#1403), wrong node found first (Brackets' bundled v6, #2953).
2. **Node genuinely missing** and non-technical users stall at "go download the MSI" (#3665, #3348, #2480, #291, #1391, #2).
3. **Installed Node not detected until reboot** — `reloadNodePath()` on Windows runs `cmd /c echo %PATH%`, which only echoes the _inherited_ PATH and can never see what an installer just added (#1236, #3665, #1450, #970).
4. **Corrupted Windows PATH breaks `spawn(..., {shell: true})` entirely** — one bad entry fails every detection command with ENOENT and the UI spins forever (#3612, #1536, #2).
5. **Node too old** — v14 (#804), v6 (#2953).

## Decisions (made with Will, 2026-07-01)

| Decision        | Choice                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Delivery        | **Download on demand** (official ~30 MB archive, checksum-verified, mirror fallback) — not bundled in the installer         |
| Precedence      | **User choice in settings**, default **system-first** (managed fills the gap when system Node is missing/unhealthy/too old) |
| Install trigger | **Explicit button only** — nothing downloads without a click                                                                |
| Platforms (v1)  | **Windows + macOS**; Linux keeps the current flow (glibc/musl headaches deferred)                                           |

Pinned version: **v22.22.3** — matches the URL `getNodeDownloadUrl()` already points users at, so UI/docs stay consistent.

## Design

### 1. Core module — `src/ipc/utils/managed_node.ts`

Mirrors the managed-pnpm pattern (#3734) in `socket_firewall.ts`. Extract the shared pieces (`prependPathSegment`, managed-tools dir helpers) into a `managed_tools.ts`.

- **Manifest pinned in code, hashes vendored at build time**: `{ version, platform/arch → { url, sha256 } }`, sha256 taken from nodejs.org's `SHASUMS256.txt` and committed. Vendored hashes mean the mirror can't tamper: primary `https://nodejs.org/dist/...`, fallback `https://registry.npmmirror.com/-/binary/node/...` (nodejs.org is unreliable from China; we have Chinese-language users, e.g. #3705).
- **Artifacts**: Windows `node-v22.22.3-win-{x64,arm64}.zip`; macOS `node-v22.22.3-darwin-{arm64,x64}.tar.gz` (tar.gz, not tar.xz — avoids an xz dependency).
- **Download** via Electron `net` (inherits system/corporate proxy config) into `userData/managed-tools/node/tmp/`, with retry and IPC progress events.
- **Atomic install**: verify sha256 → extract to temp dir → spawn extracted binary **by absolute path, `shell: false`** with `--version` → rename to `userData/managed-tools/node/v22.22.3/`. The post-extract spawn is the antivirus canary: if AV quarantined `node.exe` (AV already flags Dyad binaries — #1253, #861), fail with a targeted "your antivirus may have blocked it" error, not a mystery.
- **Single-flight promise** (like `managedPnpmInstallPromise`) so double-clicks / concurrent status checks don't race.

### 2. Precedence + PATH wiring

- New setting in `src/lib/schemas.ts` next to `customNodePath`: `nodeRuntimePreference: "system" | "managed"`, default `"system"`.
- Resolution order in `reloadNodePath()` (`src/ipc/handlers/node_handlers.ts`):
  1. `customNodePath` — an explicit manual path always wins (most deliberate signal)
  2. preference `"managed"` → managed bin dir prepended
  3. preference `"system"` → system Node if **healthy** (spawns successfully and version ≥ 20 floor — catches the v6/v14 cases); otherwise fall back to managed if installed
- Applied via `prependPathSegment` into `process.env.PATH` and `getPackageManagerCommandEnv()`, so `app_runtime_service.ts` (app spawns) and the managed-pnpm installer pick it up with no changes.
- **Bootstrap synergy**: managed pnpm's installer runs `npm install ...`; with managed Node first on PATH, that npm is managed Node's npm, and `node pnpm.cjs` runs under managed Node. Managed Node + managed pnpm = zero external environment dependencies. **Sequencing matters**: Node install must complete before triggering the pnpm install, or pnpm keeps failing against the broken system env.

### 3. IPC surface — `systemContracts` (`src/ipc/types/system.ts`)

- `getNodejsStatus` gains: `source: "system" | "managed" | "custom"`, resolved `nodePath`, `managedNodeInstalled`, `managedNodeVersion`, and `systemNodeTooOld` (distinct UI message vs. missing).
- New `installManagedNode` handler + progress event channel; `removeManagedNode` for settings.

### 4. UI

- **Preview panel Node state** (`src/components/preview_panel/PreviewPanel.tsx`, the #3738 redesign): primary button becomes **"Install Node.js for me (~30 MB)"** with a progress bar. Secondary links: "Download from nodejs.org instead" (current `handleInstallNode` behavior) and "I already have Node.js installed…" → existing `NodePathSelector`.
- **Settings → General**: show active runtime ("Node v22.22.3 — Dyad-managed" / "… — System (`/opt/homebrew/bin/node`)"), the preference toggle, and "Remove managed Node.js" (deletes the dir, flips preference back to system). Full transparency defuses the "what did you install on my machine" objection.
- On install success: re-run status, flip the card green, and auto-kick the pending preview start — the user should not have to find a retry button.

### 5. Updates & cleanup

- Version bumps ride normal Dyad releases (bump the manifest). On startup, if managed Node exists but ≠ pinned version: install the new version in the background, keep the old one until the new one passes verification, then delete the old. No self-updating outside app releases — app releases are the security-patch channel; Node security releases become "bump manifest + release" chores.
- Old-version cleanup after successful upgrade.
- Verify the Windows uninstaller clears `userData/managed-tools`; if not, add it (don't orphan ~150 MB).

## Edge cases

| Case                                                       | Handling                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline / download fails                                   | Distinct error state with "download manually from nodejs.org" fallback; never a hanging spinner (the #2/#3612 lesson)                                                                                                                                    |
| Checksum mismatch (corporate TLS interception, truncation) | Delete temp, retry once on mirror, then error naming the cause                                                                                                                                                                                           |
| Disk full mid-extract                                      | Temp dir + atomic rename — no half-installed runtime ever lands on PATH                                                                                                                                                                                  |
| AV deletes/blocks extracted `node.exe`                     | Post-extract spawn check fails → targeted error + docs link + telemetry                                                                                                                                                                                  |
| Corrupted system PATH (#3612-style ENOENT)                 | All managed-runtime operations spawn absolute paths with `shell: false`. Caveat: app dev-servers still run through a shell, so also sanitize the child env by dropping PATH entries that don't exist — this is the piece that actually closes category 4 |
| Spaces in Windows profile path (#3513)                     | Managed dir lives under `%APPDATA%` (commonly contains spaces) — the no-shell absolute-path rule covers install/verify; add an E2E with a spaced app path                                                                                                |
| Rosetta (x64 Dyad on arm64 Mac)                            | Match the app's arch (`os.arch()`); x64 Node under Rosetta works. No sysctl sniffing in v1                                                                                                                                                               |
| System Node disappears mid-session (nvm switch, uninstall) | Status re-check on window focus; runtime resolution happens per-spawn via env building, so the next run falls back per precedence                                                                                                                        |
| Preference set to "managed" but not installed              | Toggle triggers the install prompt; resolution treats not-installed managed as absent and falls back to system with a warning banner                                                                                                                     |

## Testing

`IS_TEST_BUILD` serves a tiny fixture archive from a local server (exercises the real download/verify/extract machinery with a fake payload). Specs:

- no node → install managed → preview works (closes the coverage gap called out in #1050)
- checksum mismatch → error UI
- preference toggle behavior (system-first fallback, managed-wins)
- upgrade path (old version replaced only after new version verifies)
- spaced app path on Windows

## Telemetry (PostHog)

`managed_node_install` started/succeeded/failed with failure category (network / checksum / extract / av-blocked / disk), plus `runtime_source` on app start — measures whether this kills the failure categories and informs whether to later relax "explicit button only" toward auto-install.

## Sequencing

0. **PR 0** (shipped separately, precursor): fix the Windows PATH refresh — `reloadNodePath()`'s `cmd /c echo %PATH%` can never see registry PATH changes made after launch; re-read machine+user Path from the registry instead. https://github.com/dyad-sh/dyad/pull/3742
1. **PR 1**: `managed_node.ts` + IPC + resolution wiring + settings field (no UI; dev-flag testable via a `DYAD_DEV_NODEJS_STATUS`-style override)
2. **PR 2**: preview-panel button + progress + settings UI + i18n (en/es/pt-BR/zh-CN)
3. **PR 3**: E2E suite + PATH-entry sanitization + telemetry
4. Ship to **beta channel** first; watch install-failure telemetry for AV/proxy surprises before stable.

## Out of scope (v1)

- Linux support (glibc floor check, musl fallback messaging) — v2
- Per-app Node version pinning for imported apps — natural v2 once the managed runtime exists
- Auto-install without a click — revisit with telemetry
