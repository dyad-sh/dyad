# Adding a New User Setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` in `src/lib/schemas.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/shared/settings_defaults.ts` (`src/main/settings.ts` re-exports it for existing importers). Renderer-side code must import the default from the shared module — importing `src/main/settings.ts` pulls electron/node into the renderer bundle.
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`
6. Adding a field to `DEFAULT_SETTINGS` breaks the inline snapshots in `src/main/settings.test.ts`. The snapshot helper sorts keys alphabetically, so place a manually added field in alphabetical order or, after confirming the diff is limited to the new default, regenerate with `npm test -- src/main/settings.test.ts -u`.

If the setting adds a built-in default, update the inline snapshots in
`src/main/settings.test.ts`; otherwise `npm test` will fail with
default settings snapshot mismatches.

For settings worth tracking in telemetry:

- Add the field to `getSettingsPersonTelemetryProperties` in `src/lib/posthogTelemetry.ts`, reading it as `settings.myFlag ?? DEFAULT_SETTINGS.myFlag` so the reported value matches the real default. Several branches add properties to this one object at a time, so it conflicts often on rebase — the resolution is almost always to keep both properties, not to pick a side.

For settings whose default can be overridden remotely:

- Prefer leaving the raw stored field unset until the user explicitly changes it, then compute the effective value as `stored value ?? remote default ?? built-in fallback`. Do not persist remote-applied defaults into `user-settings.json`.

For schema-validated settings:

- Assume `UserSettings` and other parsed schema types have already normalized field types. Prefer idiomatic boolean checks like `settings?.flag && !settings.hidden` over defensive literal comparisons like `settings?.flag === true && settings.hidden !== true`, unless you are intentionally handling raw unvalidated persisted data before schema parsing.
