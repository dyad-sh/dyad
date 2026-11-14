# Windows installer preflight

Dyad uses the Squirrel.Windows 2.0.1 binaries supplied by `electron-winstaller`
5.4.0. Stock Setup can partially delete an existing installation when a file is
still loaded, and concurrent Setup processes share an extraction directory.
See [#4303](https://github.com/dyad-sh/dyad/issues/4303).

Forge's `preMake` hook rebuilds **only the native Setup bootstrap** from upstream
commit `eef37460aef77b2f9de8cd2237c1e55b344a6554`. The source archive's SHA-256 is
checked before extraction. `prepare-vendor.cjs` inserts our guard immediately
before `ExtractUpdaterAndRun`, after Squirrel's administrator-to-user handoff.
The guard holds a per-user mutex across extraction, the updater process, and
cleanup. It refuses to proceed if a process runs from the target installation,
including Electron children and the installed updater. Path comparisons ignore
case and require a directory boundary. An inaccessible process with a known
Dyad/updater name also blocks the install conservatively within the current
Windows session (or when its session cannot be determined). Inaccessible
processes in another session do not block the install.

The rebuilt template replaces `Setup.exe` in a copy of the stock vendor tools
under `.cache/squirrel-vendor`. `MakerSquirrel` uses that directory for signed
and unsigned builds. The ordinary signing step signs the final generated Setup;
the managed updater, package format, and update feed are unchanged. Failed
preparation stops the build instead of falling back to a stock installer.

## Build prerequisites

Windows installation builds now require Visual Studio 2022 C++ build tools,
the v143 x86/x64 toolset, ATL, and a Windows 10/11 SDK. They are included on the
`windows-2022` GitHub Actions image. No managed Squirrel rebuild or .NET SDK is
needed. `npm run package` and non-Windows packaging do not rebuild Setup.
Making Windows installers on macOS/Linux is unsupported by this build path.

Run the focused tests in a **clean Windows user profile without Dyad installed**:

```powershell
node --test tools/windows-installer/prepare-vendor.test.cjs
node tools/windows-installer/prepare-vendor.cjs
node --test tools/windows-installer/guard.integration.test.cjs
```

The integration suite refuses to touch an existing `%LOCALAPPDATA%\dyad`
directory. On a clean profile it creates a disposable installation fixture,
builds a real Setup using the patched template, and verifies that running-app
and concurrent-installer rejection preserve existing files. It then exercises
normal installation after the blockers exit. A separate CI workflow runs this
suite; it does not run against a developer's installed Dyad.

This is a preflight, not an atomic installer. It does not prevent an app starting
after the process check, unrelated antivirus/file locks, or interference from
old, unpatched Setup downloads. Those need additional installer changes if they
remain a problem. When upgrading `electron-winstaller`/Squirrel, recheck the
pinned source, patch anchor, and generated-installer tests together.

Upstream Squirrel sources are used under the [MIT license](./SQUIRREL-LICENSE).
