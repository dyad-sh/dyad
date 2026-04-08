# Native Modules

Read this when adding Electron native dependencies such as `node-pty`, or any package that ships `.node` binaries, helper executables, or rebuild-time headers.

- This repo's `forge.config.ts` uses a deny-by-default `ignore` filter for most `node_modules` content. When adding a native dependency, explicitly allowlist the runtime package and any rebuild-time helper packages it requires (for example `node-addon-api`), or Electron Forge can fail during `Preparing native dependencies` with errors like `Cannot find module 'node-addon-api'`.
- Add native runtime packages to `vite.main.config.mts` `build.rollupOptions.external` so Vite does not bundle them into the main-process build.
- Add native runtime packages to `forge.config.ts` `rebuildConfig.extraModules` so Electron Forge rebuilds them against the packaged Electron version.
- If the package loads helper binaries from disk at runtime (for example `node-pty` loading `spawn-helper` or `winpty-agent` next to its native module), unpack the whole package directory with `packagerConfig.asar.unpackDir`; auto-unpacking `.node` files alone is not enough.
