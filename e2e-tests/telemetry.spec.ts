import { test } from "./helpers/test_helper";

test("telemetry - accept", async ({ po }) => {
  const beforeSettings = po.recordSettings();
  await po.clickTelemetryAccept();
  // Expect telemetry settings to be set
  po.snapshotSettingsDelta(beforeSettings);
});

test("telemetry - reject", async ({ po }) => {
  const beforeSettings = po.recordSettings();
  await po.clickTelemetryReject();
  // Expect telemetry settings to still NOT be set
  po.snapshotSettingsDelta(beforeSettings);
});

test("telemetry - later", async ({ po }) => {
  const beforeSettings = po.recordSettings();
  await po.clickTelemetryLater();
  // Expect telemetry settings to still NOT be set
  po.snapshotSettingsDelta(beforeSettings);
});
