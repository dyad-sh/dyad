# ABBA AI

ABBA AI is a local, open-source AI app builder forked from [Dyad](https://github.com/dyad-sh/dyad). It's fast, private, and fully under your control — like Lovable, v0, or Bolt, but running right on your machine.

## 📥 Downloads

Download the latest release for your platform:

- **Windows**: `ABBA.AI-<version>.Setup.exe`
- **macOS (Apple Silicon)**: `ABBA.AI-darwin-arm64-<version>.zip`
- **macOS (Intel)**: `ABBA.AI-darwin-x64-<version>.zip`

👉 [**Download from GitHub Releases**](https://github.com/yosiwizman/dyad/releases)

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
- **Windows pinned icon refresh (v0.1.3+)**: If your pinned taskbar icon still shows the old Dyad "D" icon after updating, unpin ABBA AI from taskbar, delete any old desktop shortcuts, then re-pin/re-create shortcuts after installing v0.1.3 or later. This is a one-time manual step due to Windows icon caching. New installs automatically use the correct ABBA "A" icon.

## 🚀 Features

- ⚡️ **Local**: Fast, private and no lock-in.
- 🛠 **Bring your own keys**: Use your own AI API keys — no vendor lock-in.
- 🖥️ **Cross-platform**: Easy to run on Mac or Windows.

## 🛠️ Contributing

**ABBA AI** is open-source (see License info below).

If you're interested in contributing, please read our [contributing](./CONTRIBUTING.md) doc or open an issue at [github.com/yosiwizman/dyad](https://github.com/yosiwizman/dyad/issues).

### CI & Release Process

**Required checks** (must pass before merge):

- Lint + prettier (`npm run presubmit`)
- TypeScript type-checking (`npm run ts`)
- Unit tests (`npm test`)
- Build smoke test (Windows + macOS)

**E2E tests** (informational, non-blocking):

- Run **nightly** at 2 AM UTC automatically
- Run **manually** via [Actions → E2E workflow → Run workflow](https://github.com/yosiwizman/dyad/actions/workflows/e2e.yml)
- Optionally run on PRs with the `run-e2e` label
- E2E tests are flaky due to Electron + Playwright environment constraints and do NOT block releases or merges

**Release workflow**:

1. Tag a version (e.g. `v0.1.4`) and push to GitHub
2. [Release workflow](https://github.com/yosiwizman/dyad/actions/workflows/release.yml) builds Windows + macOS installers
3. Assets are verified, then published to [GitHub Releases](https://github.com/yosiwizman/dyad/releases)
4. E2E results (if any) are reviewed separately and do not block the release

## License

This project is a fork of Dyad. We preserve upstream license notices.

- All the code in this repo outside of `src/pro` is open-source and licensed under Apache 2.0 - see [LICENSE](./LICENSE).
- All the code in this repo within `src/pro` is fair-source and licensed under [Functional Source License 1.1 Apache 2.0](https://fsl.software/) - see [LICENSE](./src/pro/LICENSE).
