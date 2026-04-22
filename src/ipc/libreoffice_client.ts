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
    this.ipcRenderer = ((window as any).electron?.ipcRenderer ?? {
      invoke: async (..._args: any[]) => null,
      on: () => {},
      removeListener: () => {},
    }) as any;
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

  async updateDocumentMetadata(params: { id: number; name?: string; description?: string; tags?: string[] }): Promise<BaseDocument> {
    return this.ipcRenderer.invoke("libreoffice:update-metadata", params);
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

  /**
   * Stream AI document generation. Calls the provided callback with each text
   * chunk as the AI writes, then resolves when the document has been saved.
   *
   * @param requestId   A unique ID you generate so you can match events.
   * @param onChunk     Called for each streamed text delta.
   * @param onDone      Called once with the created document (or an error string).
   */
  streamGenerateDocument(
    params: {
      requestId: string;
      type: DocumentType;
      name: string;
      options: AIGenerationOptions;
    },
    onChunk: (text: string) => void,
    onDone: (result: { document?: BaseDocument; error?: string }) => void
  ): () => void {
    const { requestId } = params;

    const unsubscribe = (this.ipcRenderer as any).on(
      "libreoffice:generate-chunk",
      (data: { requestId: string; text: string; done: boolean; document?: BaseDocument; error?: string }) => {
        if (data.requestId !== requestId) return;
        if (data.done) {
          onDone({ document: data.document, error: data.error });
        } else {
          onChunk(data.text);
        }
      }
    );

    // Fire the stream — ignore the return value, events carry progress
    this.ipcRenderer.invoke("libreoffice:stream-generate", params).catch((err: Error) => {
      onDone({ error: err.message });
    });

    // Return a cleanup function so callers can unsubscribe if they unmount early
    return typeof unsubscribe === "function" ? unsubscribe : () => {};
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

  async readDocumentContent(id: number): Promise<{
    success: boolean;
    text?: string;
    rows?: string[][];
    slides?: Array<{ title: string; content: string; notes?: string }>;
    error?: string;
  }> {
    return this.ipcRenderer.invoke("libreoffice:read-content", id);
  }

  async updateDocumentContent(
    id: number,
    payload: {
      text?: string;
      rows?: string[][];
      slides?: Array<{ title: string; content: string; notes?: string }>;
    }
  ): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("libreoffice:update-content", id, payload);
  }

  aiAssist(
    requestId: string,
    params: {
      docId: number;
      command: "improve" | "grammar" | "summarize" | "continue" | "tone" | "explain" | "custom";
      selection: string;
      context?: string;
      toneValue?: string;
      customPrompt?: string;
      provider?: string;
      model?: string;
    },
    onChunk: (text: string) => void,
    onDone: (result: { text?: string; error?: string }) => void
  ): () => void {
    const unsubscribe = (this.ipcRenderer as any).on(
      "libreoffice:ai-assist-chunk",
      (data: { requestId: string; text: string; done: boolean; error?: string }) => {
        if (data.requestId !== requestId) return;
        if (data.done) {
          onDone({ error: data.error });
        } else {
          onChunk(data.text);
        }
      }
    );

    this.ipcRenderer.invoke("libreoffice:ai-assist", requestId, params).catch((err: Error) => {
      onDone({ error: err.message });
    });

    return typeof unsubscribe === "function" ? unsubscribe : () => {};
  }
}

export const libreOfficeClient = LibreOfficeClient.getInstance();
export { LibreOfficeClient };
