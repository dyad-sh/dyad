# Electron 45 qualification

Target: Electron **45.3.2**, upgrading from 40.0.0 after the compatibility
preparation in [#5030](https://github.com/dyad-sh/dyad/pull/5030). The native-fetch
migration [#5031](https://github.com/dyad-sh/dyad/pull/5031) is already on main.

## Required compatibility changes

- Keep Forge 7.11.2. Its declared rebuild 3.7.2 fails with “Could not detect abi
  for version 45.3.2”; override rebuild to 4.1.0, whose node-abi 4.x recognizes
  the target. Developer and CI Node stay on 24.
- Pin better-sqlite3 13.1.1. The previous 12.6.2 source fails against Electron
  45's V8 headers (`GetPrototypeV2`, `PropertyCallbackInfo.This`, and callback
  signature errors). [Version 13 uses Node-API](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0).
  This changes SQLite too, so DB and integration CI must pass before merging.
- Rename `electron_wer.dll` to `dyad_wer.dll` before Windows signing. Packager
  18 renames only the executable. Electron 45's [WER helper](https://releases.electronjs.org/release/v45.0.0)
  must match the executable name; packaging fails if the helper is missing.
- Screenshot recovery E2Es now deny the modern asynchronous clipboard write,
  exercising the actual candidate-runtime adapter path.
- Wait for the initial app document in the E2E fixture: Electron 45 exposes the
  window before that navigation completes, destroying premature settings IPC.

## Automated platform evidence

`electron-qualification.yml` runs on the same four hosted platform images as
the release build: macOS ARM64, macOS Intel, Windows x64, and Ubuntu 22.04 x64
with clang 18. Each job performs a clean install and unsigned Forge `make`,
then tests packaged native modules, GitHub gzip/chunked authentication, and
screenshot recovery. Each target uploads installers and Playwright evidence.

The native probe uses the installed, unfused target Electron binary to load
dependencies from the produced ASAR: a SQLite query, a Mustard execution, a
PTY child process, and the macOS reader binding. It verifies the Electron
version and target architecture, and checks the Windows DLL's final name.
This does not use RunAsNode on the shipped executable, whose fuse stays off.
The app-flow E2Es launch the packaged application and exercise its preload.

Local macOS ARM64 `make`, format/lint/types, and focused unit tests pass.
All nine packaged native, GitHub transport, and screenshot E2Es pass locally.
The four-platform qualification and normal CI are required; a local Mac result
does not establish Windows, Linux, or Intel compatibility.

## Remaining release gates

- Electron 44+ requires **macOS 13+**. Confirm download/support messaging and
  prevent the existing update service from offering this build to macOS 12.
  A guard only in the new binary cannot protect clients already on Electron 40.
- Require the existing hosted old-Electron-40-to-candidate Keychain E2Es to pass
  with no skipped upgrade cases. These tests swap the default Keychain and
  must never run on a shared workstation.
- Perform the planned signed beta credential upgrade/restart check on a Mac,
  preserving app/bundle/signing identities. Unsigned CI does not establish
  production Keychain ACL, signing, notarization, or updater behavior.
- Validate signed release installers and an actual old-to-beta auto-update
  through the normal trusted release process. This qualification workflow
  has read-only permissions and creates no release or signed artifact.
- Keep the synchronous safeStorage compatibility layer for 45. Plan its
  asynchronous migration before 46, testing legacy recovery and write-format
  compatibility separately. See [the upgrade plan](electron-upgrade.md).
