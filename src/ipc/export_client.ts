/**
 * Export Client — Renderer-side IPC client for the export service
 */

import type { IpcRenderer } from "electron";
import type { ExportFormat, LibreOfficeStatus, DocumentSection } from "@/types/libreoffice_types";

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

class ExportClient {
  private static instance: ExportClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  static getInstance(): ExportClient {
    if (!ExportClient.instance) {
      ExportClient.instance = new ExportClient();
    }
    return ExportClient.instance;
  }

  /**
   * Export tabular data as a spreadsheet file (XLSX, CSV, PDF, etc.)
   * The file is saved to the Downloads folder and revealed in file explorer.
   */
  async exportToSpreadsheet(
    name: string,
    headers: string[],
    rows: (string | number)[][],
    format: ExportFormat
  ): Promise<ExportResult> {
    return this.ipcRenderer.invoke("export:to-spreadsheet", {
      name,
      headers,
      rows,
      format,
    });
  }

  /**
   * Export structured text as a document file (DOCX, PDF, TXT, etc.)
   * The file is saved to the Downloads folder and revealed in file explorer.
   */
  async exportToDocument(
    name: string,
    sections: DocumentSection[],
    format: ExportFormat,
    options?: { title?: string; subtitle?: string }
  ): Promise<ExportResult> {
    return this.ipcRenderer.invoke("export:to-document", {
      name,
      sections,
      format,
      title: options?.title,
      subtitle: options?.subtitle,
    });
  }

  /**
   * Get available export capabilities (which formats are supported).
   */
  async getCapabilities(): Promise<LibreOfficeStatus> {
    return this.ipcRenderer.invoke("export:capabilities");
  }
}

export const exportClient = ExportClient.getInstance();
