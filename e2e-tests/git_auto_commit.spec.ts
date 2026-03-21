import { test } from "./helpers/test_helper";

test("Git Auto-Commit Setting Controls Auto-Commit Behavior", async ({
  po,
}) => {
  const beforeSettings = po.settings.recordSettings();

  // Toggle auto-commit off
  await po.settings.toggleGitAutoCommit();

  // Verify the setting was changed in the settings file
  po.settings.snapshotSettingsDelta(beforeSettings);

  // Toggle back on
  const afterDisableSettings = po.settings.recordSettings();
  await po.settings.toggleGitAutoCommit();

  // Verify it changed back
  po.settings.snapshotSettingsDelta(afterDisableSettings);
});
