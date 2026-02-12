# Adding a New User Setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` in `src/lib/schemas.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/main/settings.ts`
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`

## Deprecating enum values in settings

When deprecating an enum value (e.g., removing a chat mode option), use a two-schema approach for backwards compatibility:

1. Create a `StoredXxxSchema` that includes both active and deprecated values (for reading existing settings files)
2. Keep the main `XxxSchema` with only active values (for runtime/UI use)
3. Add a migration helper function (e.g., `migrateStoredChatMode()`) that converts deprecated values to their replacement
4. In `readSettings()`, parse with `StoredUserSettingsSchema`, apply migrations, then validate with `UserSettingsSchema`

This ensures users with old settings files don't get validation errors while the codebase only uses active values.
