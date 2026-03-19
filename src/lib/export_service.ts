/**
 * Export Service — Reusable document export utility
 * Converts raw data (arrays, text, sections) into downloadable documents
 * via LibreOffice headless conversion or native export.
 */

import { app, shell } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { LibreOfficeManager } from "@/ipc/handlers/libreoffice_handlers";
import type {
  ExportFormat,
  DocumentContent,
  DocumentSection,
  SpreadsheetContent,
  LibreOfficeStatus,
} from "@/types/libreoffice_types";

export interface SpreadsheetExportRequest {
  name: string;
  headers: string[];
  rows: (string | number)[][];
  format: ExportFormat;
}

export interface DocumentExportRequest {
  name: string;
  sections: DocumentSection[];
  format: ExportFormat;
  title?: string;
  subtitle?: string;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * Export tabular data as a spreadsheet (XLSX, CSV, PDF, etc.)
 * Creates a temp ODS file, then converts via LibreOffice if needed.
 */
export async function exportDataToSpreadsheet(
  request: SpreadsheetExportRequest
): Promise<ExportResult> {
  const manager = LibreOfficeManager.getInstance();

  try {
    // Build spreadsheet content with headers as first row
    const cells: SpreadsheetContent["sheets"][0]["cells"] = [];
    const cols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // Add header row
    request.headers.forEach((header, i) => {
      if (i < cols.length) {
        cells.push({ row: 1, col: cols[i], value: header });
      }
    });

    // Add data rows
    request.rows.forEach((row, rowIdx) => {
      row.forEach((value, colIdx) => {
        if (colIdx < cols.length) {
          cells.push({ row: rowIdx + 2, col: cols[colIdx], value });
        }
      });
    });

    const content: SpreadsheetContent = {
      sheets: [{ name: "Data", cells }],
    };

    // Create temp ODS document
    const createResult = await manager.createDocument({
      name: `_export_${Date.now()}`,
      type: "spreadsheet",
      content: content as any,
    });

    if (!createResult.success || !createResult.document) {
      return { success: false, error: createResult.error || "Failed to create temp spreadsheet" };
    }

    const docId = createResult.document.id;

    // If native format (csv/json), or export via LibreOffice
    const exportResult = await manager.exportDocument({
      documentId: docId,
      format: request.format,
      outputPath: app.getPath("downloads"),
    });

    // Rename the export to use the requested name
    if (exportResult.success && exportResult.filePath) {
      const ext = path.extname(exportResult.filePath);
      const safeName = request.name.replace(/[^a-zA-Z0-9-_ ]/g, "_");
      const newPath = path.join(
        path.dirname(exportResult.filePath),
        `${safeName}${ext}`
      );
      // Avoid overwriting
      const finalPath = await getUniquePath(newPath);
      await fs.rename(exportResult.filePath, finalPath);
      shell.showItemInFolder(finalPath);

      // Clean up temp document
      await manager.deleteDocument(docId).catch(() => {});

      return { success: true, filePath: finalPath };
    }

    // Clean up temp document
    await manager.deleteDocument(docId).catch(() => {});

    return {
      success: false,
      error: exportResult.error || "Export failed",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Spreadsheet export failed",
    };
  }
}

/**
 * Export structured text as a document (DOCX, PDF, TXT, etc.)
 * Creates a temp ODT file, then converts via LibreOffice if needed.
 */
export async function exportTextToDocument(
  request: DocumentExportRequest
): Promise<ExportResult> {
  const manager = LibreOfficeManager.getInstance();

  try {
    const content: DocumentContent = {
      title: request.title || request.name,
      subtitle: request.subtitle,
      sections: request.sections,
    };

    // Create temp ODT document
    const createResult = await manager.createDocument({
      name: `_export_${Date.now()}`,
      type: "document",
      content,
    });

    if (!createResult.success || !createResult.document) {
      return { success: false, error: createResult.error || "Failed to create temp document" };
    }

    const docId = createResult.document.id;

    // Export to requested format
    const exportResult = await manager.exportDocument({
      documentId: docId,
      format: request.format,
      outputPath: app.getPath("downloads"),
    });

    if (exportResult.success && exportResult.filePath) {
      const ext = path.extname(exportResult.filePath);
      const safeName = request.name.replace(/[^a-zA-Z0-9-_ ]/g, "_");
      const newPath = path.join(
        path.dirname(exportResult.filePath),
        `${safeName}${ext}`
      );
      const finalPath = await getUniquePath(newPath);
      await fs.rename(exportResult.filePath, finalPath);
      shell.showItemInFolder(finalPath);

      // Clean up temp document
      await manager.deleteDocument(docId).catch(() => {});

      return { success: true, filePath: finalPath };
    }

    await manager.deleteDocument(docId).catch(() => {});

    return {
      success: false,
      error: exportResult.error || "Export failed",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Document export failed",
    };
  }
}

/**
 * Get available export capabilities based on LibreOffice status.
 */
export async function getExportCapabilities(): Promise<LibreOfficeStatus> {
  const manager = LibreOfficeManager.getInstance();
  return manager.getStatus();
}

/**
 * Generate a unique file path by appending a counter if the file already exists.
 */
async function getUniquePath(filePath: string): Promise<string> {
  try {
    await fs.access(filePath);
  } catch {
    return filePath; // File doesn't exist, use as-is
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let counter = 1;

  while (true) {
    const candidate = path.join(dir, `${base}_${counter}${ext}`);
    try {
      await fs.access(candidate);
      counter++;
    } catch {
      return candidate;
    }
  }
}
