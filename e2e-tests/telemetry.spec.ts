import { test } from "./helpers/test_helper";

test("telemetry - accept", async ({ po }) => {
  const beforeSettings = po.settings.recordSettings();
  await po.settings.clickTelemetryAccept();
  // Expect telemetry settings to be set
  po.settings.snapshotSettingsDelta(beforeSettings);
});

test("telemetry - reject", async ({ po }) => {
  const beforeSettings = po.settings.recordSettings();
  await po.settings.clickTelemetryReject();
  // Expect telemetry settings to still NOT be set
  po.settings.snapshotSettingsDelta(beforeSettings);
});

test("telemetry - later", async ({ po }) => {
  const beforeSettings = po.settings.recordSettings();
  await po.settings.clickTelemetryLater();
  // Expect telemetry settings to still NOT be set
  po.settings.snapshotSettingsDelta(beforeSettings);
});
