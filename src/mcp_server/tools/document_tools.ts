/**
 * MCP Tools — Document Studio
 *
 * Exposes document creation, listing, and export (including PNG conversion)
 * via the LibreOfficeManager singleton.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DocumentType, ExportFormat } from "@/types/libreoffice_types";

// Lazy import to avoid circular dependency with Electron app init
function getLibreOfficeManager() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { LibreOfficeManager } = require("@/ipc/handlers/libreoffice_handlers");
  return LibreOfficeManager.getInstance();
}

export function registerDocumentTools(server: McpServer) {
  // ── List documents ───────────────────────────────────────────────
  server.registerTool(
    "joycreate_list_documents",
    {
      description:
        "List documents in JoyCreate Document Studio. Can filter by type (document, spreadsheet, presentation) and search by name.",
      inputSchema: {
        type: z.enum(["document", "spreadsheet", "presentation"]).optional().describe("Filter by document type"),
        search: z.string().optional().describe("Search documents by name"),
        limit: z.number().optional().describe("Max results to return (default 20)"),
      },
    },
    async ({ type, search, limit }) => {
      const manager = getLibreOfficeManager();
      const docs = await manager.listDocuments({
        type: type as DocumentType | undefined,
        search,
        limit: limit ?? 20,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              docs.map((d: any) => ({
                id: d.id,
                name: d.name,
                type: d.type,
                format: d.format,
                status: d.status,
                createdAt: d.createdAt,
                description: d.description,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── Create document ──────────────────────────────────────────────
  server.registerTool(
    "joycreate_create_document",
    {
      description:
        "Create a new document, spreadsheet, or presentation in JoyCreate. Optionally generate content with AI by providing a prompt.",
      inputSchema: {
        name: z.string().describe("Document name"),
        type: z.enum(["document", "spreadsheet", "presentation"]).describe("Document type to create"),
        aiPrompt: z.string().optional().describe("Optional AI prompt to auto-generate document content"),
      },
    },
    async ({ name, type, aiPrompt }) => {
      const manager = getLibreOfficeManager();
      const result = await manager.createDocument({
        name,
        type: type as DocumentType,
        aiGenerate: aiPrompt ? { prompt: aiPrompt } : undefined,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: result.success
              ? `Document created: ${result.document?.name} (ID: ${result.document?.id}, path: ${result.filePath})`
              : `Failed to create document: ${result.error}`,
          },
        ],
      };
    },
  );

  // ── Export document ──────────────────────────────────────────────
  server.registerTool(
    "joycreate_export_document",
    {
      description:
        "Export a document to a different format. Supports PDF, PNG, DOCX, XLSX, PPTX, CSV, TXT, JSON, XML. PNG and PDF require LibreOffice installed.",
      inputSchema: {
        documentId: z.number().describe("The document ID to export"),
        format: z
          .enum(["pdf", "png", "docx", "xlsx", "pptx", "odt", "ods", "odp", "html", "txt", "csv", "xml", "json"])
          .describe("Target export format"),
      },
    },
    async ({ documentId, format }) => {
      const manager = getLibreOfficeManager();
      const result = await manager.exportDocument({
        documentId,
        format: format as ExportFormat,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: result.success
              ? `Exported to ${format.toUpperCase()}: ${result.filePath}`
              : `Export failed: ${result.error}`,
          },
        ],
      };
    },
  );

  // ── Get LibreOffice status ───────────────────────────────────────
  server.registerTool(
    "joycreate_libreoffice_status",
    {
      description: "Check if LibreOffice is installed and what export capabilities are available.",
      inputSchema: {},
    },
    async () => {
      const manager = getLibreOfficeManager();
      const status = await manager.getStatus();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
      };
    },
  );
}
