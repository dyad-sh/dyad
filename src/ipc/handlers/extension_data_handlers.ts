import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import {
  getExtensionData,
  getAllExtensionData,
} from "@/extensions/core/extension_data";

const logger = log.scope("extension_data_handlers");
const handle = createLoggedHandler(logger);

/**
 * Get extension data for an app
 */
async function handleGetExtensionData(
  _event: any,
  params: { extensionId: string; appId: number; key: string },
) {
  return getExtensionData(params.extensionId, params.appId, params.key);
}

/**
 * Get all extension data for an app
 */
async function handleGetAllExtensionData(
  _event: any,
  params: { extensionId: string; appId: number },
) {
  return getAllExtensionData(params.extensionId, params.appId);
}

export function registerExtensionDataHandlers() {
  handle("extension:get-data", handleGetExtensionData);
  handle("extension:get-all-data", handleGetAllExtensionData);
}
