# Native Modules

Read this when adding Electron native dependencies such as `node-pty`, or any package that ships `.node` binaries, helper executables, or rebuild-time headers.

- This repo's `forge.config.ts` uses a deny-by-default `ignore` filter for most `node_modules` content. When adding a native dependency, explicitly allowlist the runtime package and any rebuild-time helper packages it requires (for example `node-addon-api`), or Electron Forge can fail during `Preparing native dependencies` with errors like `Cannot find module 'node-addon-api'`.
- Add native runtime packages to `vite.main.config.mts` `build.rollupOptions.external` so Vite does not bundle them into the main-process build.
- Add native runtime packages to `forge.config.ts` `rebuildConfig.extraModules` so Electron Forge rebuilds them against the packaged Electron version.
- If the package loads helper binaries from disk at runtime (for example `node-pty` loading `spawn-helper` or `winpty-agent` next to its native module), unpack the whole package directory with `packagerConfig.asar.unpackDir`; auto-unpacking `.node` files alone is not enough.
- Windows release builds using `@electron/windows-sign` recursively try to sign `.ps1` scripts in packaged native dependencies. If a bundled dependency includes helper PowerShell files that are not Authenticode-signable (such as `node-pty`'s `deps/winpty/misc/*.ps1`), remove or exclude them before the Forge signing step or `signtool.exe` will fail with `Number of errors: 2`.
- Windows signing can also fail on non-Windows native prebuilds that were unpacked into the app bundle. For `node-pty`, strip Darwin-only artifacts such as `prebuilds/darwin-*` and `bin/*` before signing or `signtool.exe` may fail with `This file format cannot be signed because it is not recognized`.
- GitHub Actions jobs that use `actions/setup-node` with `node-version-file: package.json` will float to the newest Node major allowed by `engines.node`. Before widening the range, verify native dependencies' `engines`/prebuild support; otherwise `npm ci` can fail with `EBADENGINE` before tests run, as with `better-sqlite3` rejecting Node 26.
