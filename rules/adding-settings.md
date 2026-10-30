# Adding a New User Setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` in `src/lib/schemas.ts`
2. For a setting with a permanent built-in default, add its value to `DEFAULT_SETTINGS` in `src/main/settings.ts`. If renderer code also needs the default, export a narrowly scoped, side-effect-free constant from `src/shared/settings_defaults.ts` and reuse that constant in `DEFAULT_SETTINGS`; importing `src/main/settings.ts` pulls electron/node into the renderer bundle.
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`
6. Adding a field to `DEFAULT_SETTINGS` breaks the inline snapshots in `src/main/settings.test.ts`. The snapshot helper sorts keys alphabetically, so place a manually added field in alphabetical order or, after confirming the diff is limited to the new default, regenerate with `npm test -- src/main/settings.test.ts -u`.

If the setting adds a built-in default, update the inline snapshots in
`src/main/settings.test.ts`; otherwise `npm test` will fail with
default settings snapshot mismatches.

When adding any setting, decide whether to report it. Telemetry and uploaded chat sessions use allow lists, so a new setting stays unsent until you add it:

- Report non-sensitive settings by default. A setting is non-sensitive if its value is a boolean, a number, or a fixed set of options.
- Never report a setting's raw value if it can hold a credential, account details, a file path, a URL, free text, or a name the user chose. Report a derived boolean instead, such as `hasCustomAppsFolder`.
- To send a setting through both telemetry and chat sessions, add it to `getSharedSettingsDiagnostics` in `src/lib/settingsDiagnostics.ts` and to `DebugSettingsSchema` in `src/ipc/types/misc.ts`. For chat sessions only, add it to `getSessionDebugSettings` and `DebugSettingsSchema`. Use chat sessions only for settings too niche for analytics, since reporters can read a session before sending it.
- Update the pinned property names in `src/lib/posthogTelemetry.test.ts` and `src/lib/settingsDiagnostics.test.ts`. Those tests fail until the lists match, which makes each addition visible in review.

For settings reported through telemetry:

- A setting in `getSharedSettingsDiagnostics` already reaches `getSettingsPersonTelemetryProperties` in `src/lib/posthogTelemetry.ts`. If it has no value in `DEFAULT_SETTINGS`, or for a telemetry-only setting, add it to that function directly, reading it as `settings.myFlag ?? DEFAULT_MY_FLAG`. Define that fallback in the side-effect-free `src/shared/settings_defaults.ts` module. If the setting also has a `DEFAULT_SETTINGS` entry, reuse the constant there so the reported value matches the real default without importing main-process code or evaluating unrelated defaults in the renderer. A setting that stays off until enabled can read `settings.myFlag ?? false` instead. Several branches add properties to this one object at a time, so it conflicts often on rebase — the resolution is almost always to keep both properties, not to pick a side.
- Person properties are delivered as PostHog `$set` events. Keep `$set` in `shouldBypassNonProTelemetrySampling`; otherwise successful settings updates can leave sampled users' person properties stale.

For settings whose default can be overridden remotely:

- Prefer leaving the raw stored field unset until the user explicitly changes it, then compute the effective value as `stored value ?? remote default ?? built-in fallback`. Do not persist remote-applied defaults into `user-settings.json`.

For experiments that may later become enabled by default:

- Add an optional boolean to `BaseUserSettingsFields`, but leave it out of `DEFAULT_SETTINGS` while it defaults off. `undefined` is already falsey; persisting `false` would override a later default of `true` for existing users. Check the effective flag consistently wherever the experiment changes runtime behavior or generated guidance.

For schema-validated settings:

- Assume `UserSettings` and other parsed schema types have already normalized field types. Prefer idiomatic boolean checks like `settings?.flag && !settings.hidden` over defensive literal comparisons like `settings?.flag === true && settings.hidden !== true`, unless you are intentionally handling raw unvalidated persisted data before schema parsing.
- For default-on features that start background work, wait for settings to load
  before applying the field's default. Otherwise a saved `false` still starts
  work during startup; test loading settings followed by the disabled value.
