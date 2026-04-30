# Adding a New User Setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` in `src/lib/schemas.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/main/settings.ts`
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`
6. Adding a field to `DEFAULT_SETTINGS` breaks the inline snapshots in `src/__tests__/readSettings.test.ts`. After confirming the diff is just your new field, regenerate them with `npm test -- -u`.

For settings whose default can be overridden remotely:

- Prefer leaving the raw stored field unset until the user explicitly changes it, then compute the effective value as `stored value ?? remote default ?? built-in fallback`. Do not persist remote-applied defaults into `user-settings.json`.
