# ABBA AI

ABBA AI is a local, open-source AI app builder forked from [Dyad](https://github.com/dyad-sh/dyad). It's fast, private, and fully under your control — like Lovable, v0, or Bolt, but running right on your machine.

## 📥 Downloads

Download the latest release for your platform:

- **Windows**: `ABBA.AI-<version>.Setup.exe`
- **macOS (Apple Silicon)**: `ABBA.AI-darwin-arm64-<version>.zip`
- **macOS (Intel)**: `ABBA.AI-darwin-x64-<version>.zip`

👉 [**Download from GitHub Releases**](https://github.com/yosiwizman/abba-ai/releases)

### Install

#### Windows

1. Download `ABBA.AI-<version>.Setup.exe`.
2. Run the installer and follow the prompts.
3. If Windows SmartScreen warns you, click **More info** → **Run anyway**.

#### macOS (Apple Silicon)

1. Download `ABBA.AI-darwin-arm64-<version>.zip`.
2. Unzip it and drag **ABBA AI.app** to **Applications**.
3. First launch (Gatekeeper): right‑click **ABBA AI.app** → **Open** (or go to **System Settings → Privacy & Security → Open Anyway**).

#### macOS (Intel)

1. Download `ABBA.AI-darwin-x64-<version>.zip`.
2. Unzip it and drag **ABBA AI.app** to **Applications**.
3. First launch (Gatekeeper): right‑click **ABBA AI.app** → **Open** (or go to **System Settings → Privacy & Security → Open Anyway**).

Notes:

- `RELEASES` and `abba_ai-<version>-full.nupkg` are used for auto-updates; most users only need the installer/zip.

### Windows Icon Troubleshooting

**Fresh install (v0.1.10+)**: New installs automatically show the correct ABBA "A" icon everywhere:

- Setup.exe installer file icon
- Installed app EXE icon
- Desktop shortcut (auto-refreshed on install/update)
- Start Menu shortcut (auto-refreshed on install/update)
- Taskbar (when running)
- System tray / notification area (taskbar corner overflow near clock)

**v0.1.10+ shortcut refresh**: Desktop and Start Menu shortcuts are now automatically refreshed on install and update. This uses Squirrel.Windows events to remove then recreate shortcuts, ensuring icons update immediately without manual intervention.

**Upgrading from older versions**: If your taskbar, shortcut, or system tray still shows the old Dyad "D" icon:

1. **Unpin** ABBA AI from the taskbar (if pinned)
2. **Delete** any old desktop shortcuts
3. **Reset Windows icon cache** (see below)
4. **Restart** your computer
5. **Re-pin** ABBA AI from the Start Menu or re-create shortcuts

**Resetting Windows icon cache** (if restart alone doesn't work):

```powershell
# Run as Administrator in PowerShell:
taskkill /f /im explorer.exe
Remove-Item -Path "$env:LOCALAPPDATA\IconCache.db" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*" -Force -ErrorAction SilentlyContinue
Start-Process explorer.exe
```

This is a one-time step due to Windows icon caching behavior. The correct ABBA icon is embedded in v0.1.9+ builds. v0.1.10+ also auto-refreshes shortcuts on install/update to ensure icons are always correct.

#### 2-Minute Icon Verification (for developers/testers)

To verify the Windows build has correct branding on a clean system:

**Option A: Windows Sandbox** (recommended, ~2 min)

1. Enable Windows Sandbox (Settings → Apps → Optional Features → Windows Sandbox)
2. Open Windows Sandbox (clean isolated environment)
3. Download latest `ABBA.AI-<version>.Setup.exe` from [Releases](https://github.com/yosiwizman/abba-ai/releases)
4. Run installer in sandbox — verify ABBA "A" icon on installer, shortcut, and taskbar

**Option B: New local Windows user** (~2 min)

1. Create a new local user account
2. Log in as new user (fresh icon cache)
3. Install ABBA AI and verify icons

**If icons are wrong**: Open an issue with screenshot evidence.

**Technical details**: Windows uses AppUserModelId (AUMID) for taskbar icon grouping. Squirrel.Windows creates shortcuts with AUMID pattern `com.squirrel.<name>.<name>`. The app's `setAppUserModelId()` MUST match this pattern — mismatch causes wrong icons. ABBA AI uses `com.squirrel.abba_ai.abba_ai`. CI verifies icons by SHA256 hash (`npm run verify-icon-hashes`).

### Icon Pipeline (for developers)

All icon files are generated from a single canonical source: `assets/logo.svg` (the ABBA "A" artwork).

**Regenerating icons** (if artwork changes):

```bash
npm run regenerate-icons
```

This generates:

- `assets/brand/abba-logo-1024.png` - Canonical master PNG
- `assets/icon/logo.ico` - Windows app icon (16/32/48/64/128/256)
- `assets/icon/logo.icns` - macOS app icon
- `assets/icon/logo.png` - Linux / general (1024px)
- `assets/icon/tray.ico` - Windows tray icon (16/24/32/48/64)

**CI verification**: Icons are verified by SHA256 hash, not just existence. This prevents shipping incorrect artwork.

## 🚀 Features

- ⚡️ **Local**: Fast, private and no lock-in.
- 🛠 **Bring your own keys**: Use your own AI API keys — no vendor lock-in.
- 🖥️ **Cross-platform**: Easy to run on Mac or Windows.

## 🛠️ Contributing

**ABBA AI** is open-source (see License info below).

If you're interested in contributing, please read our [contributing](./CONTRIBUTING.md) doc or open an issue at [github.com/yosiwizman/abba-ai](https://github.com/yosiwizman/abba-ai/issues).

### CI & Release Process

**Required checks** (must pass before merge):

- Lint + prettier (`npm run presubmit`)
- TypeScript type-checking (`npm run ts`)
- Unit tests (`npm test`)
- Build smoke test (Windows + macOS)
- Branding verification (`npm run verify-branding`)
- Windows AUMID consistency (`npm run verify-windows-aumid`)
- Tray icon configuration (`npm run verify-tray-icon`)
- **Icon hash verification** (`npm run verify-icon-hashes`) - ensures ABBA artwork
- **Squirrel shortcut handler** (`npm run verify-squirrel-shortcuts`) - ensures shortcut refresh on Windows
- Windows EXE icon verification (`npm run verify-windows-icon`, Windows CI only)

**E2E tests** (informational, non-blocking):

- Run **nightly** at 2 AM UTC automatically
- Run **manually** via [Actions → E2E workflow → Run workflow](https://github.com/yosiwizman/abba-ai/actions/workflows/e2e.yml)
- Optionally run on PRs with the `run-e2e` label
- E2E tests are flaky due to Electron + Playwright environment constraints and do NOT block releases or merges

**Release workflow**:

1. Tag a version (e.g. `v0.1.4`) and push to GitHub
2. [Release workflow](https://github.com/yosiwizman/abba-ai/actions/workflows/release.yml) builds Windows + macOS installers
3. Assets are verified, then published to [GitHub Releases](https://github.com/yosiwizman/abba-ai/releases)
4. E2E results (if any) are reviewed separately and do not block the release

## License

This project is a fork of Dyad. We preserve upstream license notices.

- All the code in this repo outside of `src/pro` is open-source and licensed under Apache 2.0 - see [LICENSE](./LICENSE).
- All the code in this repo within `src/pro` is fair-source and licensed under [Functional Source License 1.1 Apache 2.0](https://fsl.software/) - see [LICENSE](./src/pro/LICENSE).
