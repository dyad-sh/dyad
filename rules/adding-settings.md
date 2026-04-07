# Adding a New User Setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` in `src/lib/schemas.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/main/settings.ts`
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`

For settings whose default can be overridden remotely:

- `readSettings()` writes `DEFAULT_SETTINGS` to `user-settings.json` on first read, so the stored file alone cannot tell you whether a value came from the user or from the built-in default. Persist a separate marker (for example `userModifiedSettings.<settingId>`) and only let the remote default win when that marker is absent.
