/**
 * LibreOffice IPC Client
 * Renderer-side client for document creation and management
 */

import type { IpcRenderer } from "electron";
import type {
  DocumentType,
  DocumentFormat,
  ExportFormat,
  CreateDocumentRequest,
  ExportDocumentRequest,
  DocumentListQuery,
  LibreOfficeStatus,
  DocumentOperationResult,
  BaseDocument,
  AIGenerationOptions,
  DocumentContent,
  SpreadsheetContent,
  PresentationContent,
} from "@/types/libreoffice_types";

class LibreOfficeClient {
  private static instance: LibreOfficeClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  static getInstance(): LibreOfficeClient {
    if (!LibreOfficeClient.instance) {
      LibreOfficeClient.instance = new LibreOfficeClient();
    }
    return LibreOfficeClient.instance;
  }

  // ============================================================================
  // Status
  // ============================================================================

  async getStatus(): Promise<LibreOfficeStatus> {
    return this.ipcRenderer.invoke("libreoffice:status");
  }

  /**
   * Force re-detection of LibreOffice (clears cached path and re-scans).
   * Useful after user installs LibreOffice while the app is running.
   */
  async refreshStatus(): Promise<LibreOfficeStatus> {
    return this.ipcRenderer.invoke("libreoffice:refresh-status");
  }

  // ============================================================================
  // Document CRUD Operations
  // ============================================================================

  async createDocument(request: CreateDocumentRequest): Promise<DocumentOperationResult> {
    return this.ipcRenderer.invoke("libreoffice:create", request);
  }

  async listDocuments(query?: DocumentListQuery): Promise<BaseDocument[]> {
    return this.ipcRenderer.invoke("libreoffice:list", query);
  }

  async getDocument(id: number): Promise<BaseDocument | null> {
    return this.ipcRenderer.invoke("libreoffice:get", id);
  }

  async deleteDocument(id: number): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("libreoffice:delete", id);
  }

  // ============================================================================
  // Export Operations
  // ============================================================================

  async exportDocument(request: ExportDocumentRequest): Promise<DocumentOperationResult> {
    return this.ipcRenderer.invoke("libreoffice:export", request);
  }

  async exportToPdf(documentId: number, outputPath?: string): Promise<DocumentOperationResult> {
    return this.exportDocument({
      documentId,
      format: "pdf",
      outputPath,
    });
  }

  async exportToDocx(documentId: number, outputPath?: string): Promise<DocumentOperationResult> {
    return this.exportDocument({
      documentId,
      format: "docx",
      outputPath,
    });
  }

  async exportToXlsx(documentId: number, outputPath?: string): Promise<DocumentOperationResult> {
    return this.exportDocument({
      documentId,
      format: "xlsx",
      outputPath,
    });
  }

  async exportToPptx(documentId: number, outputPath?: string): Promise<DocumentOperationResult> {
    return this.exportDocument({
      documentId,
      format: "pptx",
      outputPath,
    });
  }

  async exportToPng(documentId: number, outputPath?: string): Promise<DocumentOperationResult> {
    return this.exportDocument({
      documentId,
      format: "png",
      outputPath,
    });
  }

  // ============================================================================
  // Document Management
  // ============================================================================

  async openDocument(id: number): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("libreoffice:open", id);
  }

  async downloadDocument(id: number): Promise<DocumentOperationResult> {
    return this.ipcRenderer.invoke("libreoffice:download", id);
  }

  async showDocumentInFolder(id: number): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("libreoffice:show-in-folder", id);
  }

  async getDocumentsDirectory(): Promise<string> {
    return this.ipcRenderer.invoke("libreoffice:get-directory");
  }

  // ============================================================================
  // Helper Methods for Quick Document Creation
  // ============================================================================

  async createBlankDocument(name: string): Promise<DocumentOperationResult> {
    return this.createDocument({
      name,
      type: "document",
    });
  }

  async createBlankSpreadsheet(name: string): Promise<DocumentOperationResult> {
    return this.createDocument({
      name,
      type: "spreadsheet",
    });
  }

  async createBlankPresentation(name: string): Promise<DocumentOperationResult> {
    return this.createDocument({
      name,
      type: "presentation",
    });
  }

  async createDocumentWithContent(
    name: string,
    content: DocumentContent
  ): Promise<DocumentOperationResult> {
    return this.createDocument({
      name,
      type: "document",
      content,
    });
  }

  async createSpreadsheetWithContent(
    name: string,
    content: SpreadsheetContent
  ): Promise<DocumentOperationResult> {
    return this.createDocument({
      name,
      type: "spreadsheet",
      content: content as any,
    });
  }

  async createPresentationWithContent(
    name: string,
    content: PresentationContent
  ): Promise<DocumentOperationResult> {
    return this.createDocument({
      name,
      type: "presentation",
      content: content as any,
    });
  }

  // ============================================================================
  // AI-Powered Document Generation
  // ============================================================================

  async generateDocument(
    name: string,
    type: DocumentType,
    aiOptions: AIGenerationOptions
  ): Promise<DocumentOperationResult> {
    return this.createDocument({
      name,
      type,
      aiGenerate: aiOptions,
    });
  }

  async generateReport(
    name: string,
    prompt: string,
    options?: Partial<AIGenerationOptions>
  ): Promise<DocumentOperationResult> {
    return this.generateDocument(name, "document", {
      prompt,
      tone: "professional",
      ...options,
    });
  }

  async generatePresentation(
    name: string,
    prompt: string,
    options?: Partial<AIGenerationOptions>
  ): Promise<DocumentOperationResult> {
    return this.generateDocument(name, "presentation", {
      prompt,
      tone: "professional",
      ...options,
    });
  }

  async generateSpreadsheet(
    name: string,
    prompt: string,
    options?: Partial<AIGenerationOptions>
  ): Promise<DocumentOperationResult> {
    return this.generateDocument(name, "spreadsheet", {
      prompt,
      ...options,
    });
  }

  // ============================================================================
  // Lifecycle — call ensureReady when the documents page opens and shutdown
  // when it closes so LibreOffice only runs when actively needed.
  // ============================================================================

  async ensureReady(): Promise<LibreOfficeStatus> {
    return this.ipcRenderer.invoke("libreoffice:ensure-ready");
  }

  async shutdown(): Promise<void> {
    return this.ipcRenderer.invoke("libreoffice:shutdown");
  }
}

export const libreOfficeClient = LibreOfficeClient.getInstance();
export { LibreOfficeClient };
