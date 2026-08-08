import { createTypedHandler } from "./base";
import { cloudAppsContracts } from "../types/cloud_apps";
import {
  backupAppSource,
  listCloudApps,
  restoreAppFromCloud,
} from "../utils/app_cloud_backup";

export function registerCloudAppsHandlers() {
  createTypedHandler(cloudAppsContracts.backup, async (_, { appId }) => {
    await backupAppSource(appId);
    return { ok: true };
  });

  createTypedHandler(cloudAppsContracts.list, async () => listCloudApps());

  createTypedHandler(cloudAppsContracts.restore, async (_, input) =>
    restoreAppFromCloud(input),
  );
}
