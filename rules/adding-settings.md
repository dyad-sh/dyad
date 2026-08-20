# Adding a New User Setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` in `src/lib/schemas.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/main/settings.ts`. If renderer code also needs the default, export a narrowly scoped, side-effect-free constant from `src/shared/settings_defaults.ts` and reuse that constant in `DEFAULT_SETTINGS`; importing `src/main/settings.ts` pulls electron/node into the renderer bundle.
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`
6. Adding a field to `DEFAULT_SETTINGS` breaks the inline snapshots in `src/main/settings.test.ts`. The snapshot helper sorts keys alphabetically, so place a manually added field in alphabetical order or, after confirming the diff is limited to the new default, regenerate with `npm test -- src/main/settings.test.ts -u`.

Every settings search-index entry must point to an element that renders with the
same ID. If the control is conditional (for example, Pro-only), encode that
availability in the index and filter search surfaces with the same condition so
they never offer a destination that cannot render.

If the setting adds a built-in default, update the inline snapshots in
`src/main/settings.test.ts`; otherwise `npm test` will fail with
default settings snapshot mismatches.

For settings worth tracking in telemetry:

- Add the field to `getSettingsPersonTelemetryProperties` in `src/lib/posthogTelemetry.ts`, reading it as `settings.myFlag ?? DEFAULT_MY_FLAG`. Define that fallback in the side-effect-free `src/shared/settings_defaults.ts` module and reuse it in `DEFAULT_SETTINGS` so the reported value matches the real default without importing main-process code or evaluating unrelated defaults in the renderer. Several branches add properties to this one object at a time, so it conflicts often on rebase — the resolution is almost always to keep both properties, not to pick a side.
- Person properties are delivered as PostHog `$set` events. Keep `$set` in `shouldBypassNonProTelemetrySampling`; otherwise successful settings updates can leave sampled users' person properties stale.

For settings whose default can be overridden remotely:

- Prefer leaving the raw stored field unset until the user explicitly changes it, then compute the effective value as `stored value ?? remote default ?? built-in fallback`. Do not persist remote-applied defaults into `user-settings.json`.

For schema-validated settings:

- Assume `UserSettings` and other parsed schema types have already normalized field types. Prefer idiomatic boolean checks like `settings?.flag && !settings.hidden` over defensive literal comparisons like `settings?.flag === true && settings.hidden !== true`, unless you are intentionally handling raw unvalidated persisted data before schema parsing.
