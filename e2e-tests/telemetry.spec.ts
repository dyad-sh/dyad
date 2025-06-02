import { test } from "./helpers/test_helper";

test("telemetry - accept", async ({ po }) => {
  // Expect NO telemetry settings to be set
  await po.snapshotSettings();

  await po.clickTelemetryAccept();
  // Expect telemetry settings to be set
  await po.snapshotSettings();
});

test("telemetry - reject", async ({ po }) => {
  // Expect NO telemetry settings to be set
  await po.snapshotSettings();

  await po.clickTelemetryReject();
  // Expect telemetry settings to still NOT be set
  await po.snapshotSettings();
});

test("telemetry - later", async ({ po }) => {
  // Expect NO telemetry settings to be set
  await po.snapshotSettings();

  await po.clickTelemetryLater();
  // Expect telemetry settings to still NOT be set
  await po.snapshotSettings();
});
