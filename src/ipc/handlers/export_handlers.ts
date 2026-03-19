/**
 * Export Handlers — IPC handlers for the reusable export service
 * Provides channels for exporting data to various document formats.
 */

import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import {
  exportDataToSpreadsheet,
  exportTextToDocument,
  getExportCapabilities,
  type SpreadsheetExportRequest,
  type DocumentExportRequest,
} from "@/lib/export_service";

const logger = log.scope("export_handlers");
const handle = createLoggedHandler(logger);

export function registerExportHandlers() {
  handle("export:to-spreadsheet", async (_event, request: SpreadsheetExportRequest) => {
    if (!request.name || !request.headers || !request.rows || !request.format) {
      throw new Error("Missing required fields: name, headers, rows, format");
    }
    const result = await exportDataToSpreadsheet(request);
    if (!result.success) {
      throw new Error(result.error || "Spreadsheet export failed");
    }
    return result;
  });

  handle("export:to-document", async (_event, request: DocumentExportRequest) => {
    if (!request.name || !request.sections || !request.format) {
      throw new Error("Missing required fields: name, sections, format");
    }
    const result = await exportTextToDocument(request);
    if (!result.success) {
      throw new Error(result.error || "Document export failed");
    }
    return result;
  });

  handle("export:capabilities", async () => {
    return getExportCapabilities();
  });
}
