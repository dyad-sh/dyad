import { test } from "./helpers/test_helper";

test("switching smart context mode saves the right setting", async ({ po }) => {
  await po.setUpDyadPro();
  const proModesDialog = await po.openProModesDialog({
    location: "home-chat-input-container",
  });
  await po.snapshotSettings();
  await proModesDialog.setSmartContextMode("balanced");
  await po.snapshotSettings();
  await proModesDialog.setSmartContextMode("off");
  await po.snapshotSettings();
  await proModesDialog.setSmartContextMode("conservative");
  await po.snapshotSettings();
});
