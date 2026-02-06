# Adding a New User Setting

When adding a new toggle/setting to the Settings page:

1. Add the field to `UserSettingsSchema` in `src/lib/schemas.ts`
2. Add the default value in `DEFAULT_SETTINGS` in `src/main/settings.ts`
3. Add a `SETTING_IDS` entry and search index entry in `src/lib/settingsSearchIndex.ts`
4. Create a switch component (e.g., `src/components/MySwitch.tsx`) - follow `AutoApproveSwitch.tsx` as a template
5. Import and add the switch to the relevant section in `src/pages/settings.tsx`
