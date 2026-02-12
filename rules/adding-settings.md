# Adding a New User Setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` **and** `StoredUserSettingsSchema` in `src/lib/schemas.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/main/settings.ts`
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`

## Schema split: Stored vs Active

Settings has two schemas:

- **`StoredUserSettingsSchema`** — includes deprecated fields (e.g., `"agent"` chat mode). Used for reading/writing the JSON file on disk so old settings files still parse.
- **`UserSettingsSchema`** — active fields only (no deprecated values). Used at runtime throughout the app.

`readSettings()` parses with `StoredUserSettingsSchema`, migrates deprecated values (e.g., `"agent"` → `"build"`), and returns `UserSettings`. When deprecating a field or enum value, add the migration in `readSettings()` and keep the old value in `StoredUserSettingsSchema` only.
