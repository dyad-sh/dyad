/**
 * LibreOffice Headless Integration Handlers
 * Handles document creation, editing, and export via LibreOffice
 */

import { ipcMain, app } from "electron";
import { spawn, exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { getDb } from "@/db";
import { documents, documentTemplates } from "@/db/schema";
import { eq, desc, like, and, or } from "drizzle-orm";
import type {
  DocumentType,
  DocumentFormat,
  ExportFormat,
  CreateDocumentRequest,
  DocumentContent,
  SpreadsheetContent,
  PresentationContent,
  ExportDocumentRequest,
  DocumentListQuery,
  LibreOfficeStatus,
  DocumentOperationResult,
  BaseDocument,
  AIGenerationOptions,
} from "@/types/libreoffice_types";

const execAsync = promisify(exec);

// LibreOffice paths for different platforms
const LIBREOFFICE_PATHS = {
  win32: [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files\\LibreOffice\\program\\soffice.com",
  ],
  darwin: [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/local/bin/soffice",
  ],
  linux: [
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/usr/local/bin/soffice",
    "/snap/bin/libreoffice",
  ],
};

// Document format mappings
const FORMAT_EXTENSIONS: Record<DocumentType, DocumentFormat> = {
  document: "odt",
  spreadsheet: "ods",
  presentation: "odp",
};

const EXPORT_FILTERS: Record<ExportFormat, string> = {
  pdf: "writer_pdf_Export",
  docx: "MS Word 2007 XML",
  xlsx: "Calc MS Excel 2007 XML",
  pptx: "Impress MS PowerPoint 2007 XML",
  odt: "writer8",
  ods: "calc8",
  odp: "impress8",
  html: "HTML (StarWriter)",
  txt: "Text",
  csv: "Text - txt - csv (StarCalc)",
};

class LibreOfficeManager {
  private static instance: LibreOfficeManager;
  private libreOfficePath: string | null = null;
  private documentsDir: string;

  private constructor() {
    this.documentsDir = path.join(app.getPath("userData"), "documents");
    this.initializeDirectories();
  }

  static getInstance(): LibreOfficeManager {
    if (!LibreOfficeManager.instance) {
      LibreOfficeManager.instance = new LibreOfficeManager();
    }
    return LibreOfficeManager.instance;
  }

  private async initializeDirectories() {
    try {
      await fs.mkdir(this.documentsDir, { recursive: true });
      await fs.mkdir(path.join(this.documentsDir, "exports"), { recursive: true });
      await fs.mkdir(path.join(this.documentsDir, "templates"), { recursive: true });
      await fs.mkdir(path.join(this.documentsDir, "thumbnails"), { recursive: true });
    } catch (error) {
      console.error("Failed to create documents directories:", error);
    }
  }

  async findLibreOffice(): Promise<string | null> {
    if (this.libreOfficePath) return this.libreOfficePath;

    const platform = process.platform as keyof typeof LIBREOFFICE_PATHS;
    const paths = LIBREOFFICE_PATHS[platform] || [];

    for (const p of paths) {
      try {
        await fs.access(p);
        this.libreOfficePath = p;
        return p;
      } catch {
        continue;
      }
    }

    // Try to find via command
    try {
      if (platform === "win32") {
        const { stdout } = await execAsync("where soffice.exe 2>nul");
        if (stdout.trim()) {
          this.libreOfficePath = stdout.trim().split("\n")[0];
          return this.libreOfficePath;
        }
      } else {
        const { stdout } = await execAsync("which soffice 2>/dev/null || which libreoffice 2>/dev/null");
        if (stdout.trim()) {
          this.libreOfficePath = stdout.trim();
          return this.libreOfficePath;
        }
      }
    } catch {
      // Command not found
    }

    return null;
  }

  async getStatus(): Promise<LibreOfficeStatus> {
    const loPath = await this.findLibreOffice();
    
    if (!loPath) {
      return {
        installed: false,
        headlessSupport: false,
      };
    }

    try {
      const { stdout } = await execAsync(`"${loPath}" --version`);
      const versionMatch = stdout.match(/LibreOffice\s+([\d.]+)/);
      
      return {
        installed: true,
        version: versionMatch ? versionMatch[1] : "unknown",
        path: loPath,
        headlessSupport: true,
      };
    } catch (error) {
      return {
        installed: true,
        path: loPath,
        headlessSupport: true,
      };
    }
  }

  async createDocument(
    request: CreateDocumentRequest
  ): Promise<DocumentOperationResult> {
    const db = getDb();
    const loPath = await this.findLibreOffice();

    if (!loPath) {
      return {
        success: false,
        error: "LibreOffice is not installed. Please install LibreOffice to create documents.",
      };
    }

    try {
      const format = request.format || FORMAT_EXTENSIONS[request.type];
      const fileName = `${request.name.replace(/[^a-zA-Z0-9-_]/g, "_")}_${Date.now()}.${format}`;
      const filePath = path.join(this.documentsDir, fileName);

      // Create the document based on type
      let content: string;
      
      if (request.type === "document") {
        content = this.generateDocumentXML(request.content);
      } else if (request.type === "spreadsheet") {
        content = this.generateSpreadsheetXML(request.content as SpreadsheetContent);
      } else {
        content = this.generatePresentationXML(request.content as PresentationContent);
      }

      // Write the initial content
      await this.writeDocumentContent(filePath, request.type, content);

      // Insert into database
      const [doc] = await db
        .insert(documents)
        .values({
          name: request.name,
          type: request.type,
          format: format,
          status: "ready",
          filePath: filePath,
          description: request.content?.metadata?.description || null,
        })
        .returning();

      return {
        success: true,
        document: {
          id: doc.id,
          name: doc.name,
          type: doc.type as DocumentType,
          format: doc.format as DocumentFormat,
          status: doc.status as any,
          filePath: doc.filePath,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          description: doc.description || undefined,
        },
        filePath,
      };
    } catch (error) {
      console.error("Failed to create document:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create document",
      };
    }
  }

  private generateDocumentXML(content?: DocumentContent): string {
    const title = content?.title || "Untitled Document";
    const sections = content?.sections || [];

    let body = "";
    for (const section of sections) {
      if (section.type === "heading") {
        const level = section.level || 1;
        body += `<text:h text:style-name="Heading_${level}" text:outline-level="${level}">${this.escapeXML(section.content as string)}</text:h>\n`;
      } else if (section.type === "paragraph") {
        body += `<text:p text:style-name="Text_20_body">${this.escapeXML(section.content as string)}</text:p>\n`;
      } else if (section.type === "list") {
        const listContent = section.content as { items: string[]; ordered?: boolean };
        body += `<text:list text:style-name="${listContent.ordered ? "Numbering_1" : "List_1"}">\n`;
        for (const item of listContent.items) {
          body += `  <text:list-item><text:p>${this.escapeXML(item)}</text:p></text:list-item>\n`;
        }
        body += `</text:list>\n`;
      }
    }

    if (!body) {
      body = `<text:p text:style-name="Title">${this.escapeXML(title)}</text:p>\n`;
      if (content?.subtitle) {
        body += `<text:p text:style-name="Subtitle">${this.escapeXML(content.subtitle)}</text:p>\n`;
      }
      body += `<text:p text:style-name="Text_20_body"></text:p>\n`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  office:version="1.2">
  <office:body>
    <office:text>
      ${body}
    </office:text>
  </office:body>
</office:document-content>`;
  }

  private generateSpreadsheetXML(content?: SpreadsheetContent): string {
    const sheets = content?.sheets || [{ name: "Sheet1", cells: [] }];
    
    let sheetContent = "";
    for (const sheet of sheets) {
      sheetContent += `<table:table table:name="${this.escapeXML(sheet.name)}">\n`;
      
      // Build rows from cells
      const rowMap = new Map<number, Map<string, any>>();
      for (const cell of sheet.cells) {
        if (!rowMap.has(cell.row)) {
          rowMap.set(cell.row, new Map());
        }
        rowMap.get(cell.row)!.set(cell.col, cell);
      }

      const maxRow = Math.max(...Array.from(rowMap.keys()), 1);
      for (let r = 1; r <= maxRow; r++) {
        sheetContent += `  <table:table-row>\n`;
        const rowCells = rowMap.get(r) || new Map();
        // Simplified: just output cells A-Z for now
        const cols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        for (const col of cols) {
          const cell = rowCells.get(col);
          if (cell) {
            const valueType = typeof cell.value === "number" ? "float" : "string";
            sheetContent += `    <table:table-cell office:value-type="${valueType}"`;
            if (valueType === "float") {
              sheetContent += ` office:value="${cell.value}"`;
            }
            sheetContent += `><text:p>${this.escapeXML(String(cell.value))}</text:p></table:table-cell>\n`;
          } else {
            sheetContent += `    <table:table-cell/>\n`;
          }
        }
        sheetContent += `  </table:table-row>\n`;
      }
      
      sheetContent += `</table:table>\n`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  office:version="1.2">
  <office:body>
    <office:spreadsheet>
      ${sheetContent}
    </office:spreadsheet>
  </office:body>
</office:document-content>`;
  }

  private generatePresentationXML(content?: PresentationContent): string {
    const slides = content?.slides || [{ layout: "title" as const, title: "Untitled Presentation" }];
    
    let slideContent = "";
    for (const slide of slides) {
      slideContent += `<draw:page draw:style-name="dp1" draw:master-page-name="Default">\n`;
      
      if (slide.title) {
        slideContent += `  <draw:frame draw:style-name="gr1" draw:layer="layout" svg:width="25.4cm" svg:height="3.506cm" svg:x="1.4cm" svg:y="0.962cm">
    <draw:text-box>
      <text:p text:style-name="Title">${this.escapeXML(slide.title)}</text:p>
    </draw:text-box>
  </draw:frame>\n`;
      }
      
      if (slide.subtitle) {
        slideContent += `  <draw:frame draw:style-name="gr2" draw:layer="layout" svg:width="25.4cm" svg:height="1.8cm" svg:x="1.4cm" svg:y="5cm">
    <draw:text-box>
      <text:p text:style-name="Subtitle">${this.escapeXML(slide.subtitle)}</text:p>
    </draw:text-box>
  </draw:frame>\n`;
      }

      // Add content sections
      if (slide.content) {
        let yPos = slide.subtitle ? 7 : 5;
        for (const section of slide.content) {
          slideContent += `  <draw:frame draw:style-name="gr3" draw:layer="layout" svg:width="25.4cm" svg:height="2cm" svg:x="1.4cm" svg:y="${yPos}cm">
    <draw:text-box>
      <text:p>${this.escapeXML(section.content as string)}</text:p>
    </draw:text-box>
  </draw:frame>\n`;
          yPos += 2.5;
        }
      }

      slideContent += `</draw:page>\n`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.2">
  <office:body>
    <office:presentation>
      ${slideContent}
    </office:presentation>
  </office:body>
</office:document-content>`;
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private async writeDocumentContent(
    filePath: string,
    type: DocumentType,
    content: string
  ): Promise<void> {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip();

    // Create ODF structure
    const mimetypes: Record<DocumentType, string> = {
      document: "application/vnd.oasis.opendocument.text",
      spreadsheet: "application/vnd.oasis.opendocument.spreadsheet",
      presentation: "application/vnd.oasis.opendocument.presentation",
    };

    // Add mimetype (must be first and uncompressed)
    zip.addFile("mimetype", Buffer.from(mimetypes[type]));

    // Add content.xml
    zip.addFile("content.xml", Buffer.from(content, "utf8"));

    // Add manifest
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetypes[type]}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
    zip.addFile("META-INF/manifest.xml", Buffer.from(manifest, "utf8"));

    // Add basic styles
    const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.2">
  <office:styles>
    <style:style style:name="Title" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center"/>
      <style:text-properties fo:font-size="24pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Subtitle" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center"/>
      <style:text-properties fo:font-size="18pt" fo:color="#666666"/>
    </style:style>
    <style:style style:name="Heading_1" style:family="paragraph">
      <style:text-properties fo:font-size="20pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Heading_2" style:family="paragraph">
      <style:text-properties fo:font-size="16pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Text_20_body" style:family="paragraph">
      <style:text-properties fo:font-size="12pt"/>
    </style:style>
  </office:styles>
</office:document-styles>`;
    zip.addFile("styles.xml", Buffer.from(styles, "utf8"));

    // Add meta.xml
    const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  office:version="1.2">
  <office:meta>
    <meta:generator>JoyCreate</meta:generator>
    <meta:creation-date>${new Date().toISOString()}</meta:creation-date>
    <dc:creator>JoyCreate</dc:creator>
  </office:meta>
</office:document-meta>`;
    zip.addFile("meta.xml", Buffer.from(meta, "utf8"));

    await zip.writeZipPromise(filePath);
  }

  async exportDocument(request: ExportDocumentRequest): Promise<DocumentOperationResult> {
    const db = getDb();
    const loPath = await this.findLibreOffice();

    if (!loPath) {
      return {
        success: false,
        error: "LibreOffice is not installed",
      };
    }

    try {
      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, request.documentId))
        .limit(1);

      if (!doc) {
        return { success: false, error: "Document not found" };
      }

      const outputDir = request.outputPath || path.join(this.documentsDir, "exports");
      const outputFileName = `${path.basename(doc.filePath, path.extname(doc.filePath))}.${request.format}`;
      const outputPath = path.join(outputDir, outputFileName);

      // Use LibreOffice headless to convert
      const filter = EXPORT_FILTERS[request.format] || "writer_pdf_Export";
      
      await new Promise<void>((resolve, reject) => {
        const args = [
          "--headless",
          "--convert-to",
          `${request.format}:${filter}`,
          "--outdir",
          outputDir,
          doc.filePath,
        ];

        const proc = spawn(loPath, args);
        
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`LibreOffice exited with code ${code}`));
          }
        });

        proc.on("error", reject);
      });

      return {
        success: true,
        filePath: outputPath,
      };
    } catch (error) {
      console.error("Failed to export document:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to export document",
      };
    }
  }

  async listDocuments(query?: DocumentListQuery): Promise<BaseDocument[]> {
    const db = getDb();
    
    let conditions = [];
    
    if (query?.type) {
      conditions.push(eq(documents.type, query.type));
    }
    if (query?.status) {
      conditions.push(eq(documents.status, query.status));
    }
    if (query?.search) {
      conditions.push(
        or(
          like(documents.name, `%${query.search}%`),
          like(documents.description, `%${query.search}%`)
        )
      );
    }

    const results = await db
      .select()
      .from(documents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(documents.updatedAt))
      .limit(query?.limit || 50)
      .offset(query?.offset || 0);

    return results.map((doc) => ({
      id: doc.id,
      name: doc.name,
      type: doc.type as DocumentType,
      format: doc.format as DocumentFormat,
      status: doc.status as any,
      filePath: doc.filePath,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      description: doc.description || undefined,
    }));
  }

  async getDocument(id: number): Promise<BaseDocument | null> {
    const db = getDb();
    
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) return null;

    return {
      id: doc.id,
      name: doc.name,
      type: doc.type as DocumentType,
      format: doc.format as DocumentFormat,
      status: doc.status as any,
      filePath: doc.filePath,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      description: doc.description || undefined,
    };
  }

  async deleteDocument(id: number): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    
    try {
      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1);

      if (!doc) {
        return { success: false, error: "Document not found" };
      }

      // Delete the file
      try {
        await fs.unlink(doc.filePath);
      } catch {
        // File may not exist
      }

      // Delete from database
      await db.delete(documents).where(eq(documents.id, id));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete document",
      };
    }
  }

  async openDocument(id: number): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    const loPath = await this.findLibreOffice();

    if (!loPath) {
      return { success: false, error: "LibreOffice is not installed" };
    }

    try {
      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1);

      if (!doc) {
        return { success: false, error: "Document not found" };
      }

      // Open in LibreOffice
      spawn(loPath, [doc.filePath], { detached: true, stdio: "ignore" }).unref();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to open document",
      };
    }
  }

  getDocumentsDirectory(): string {
    return this.documentsDir;
  }
}

// Register IPC handlers
export function registerLibreOfficeHandlers() {
  const manager = LibreOfficeManager.getInstance();

  // Status
  ipcMain.handle("libreoffice:status", async () => {
    return manager.getStatus();
  });

  // Create document
  ipcMain.handle("libreoffice:create", async (_, request: CreateDocumentRequest) => {
    return manager.createDocument(request);
  });

  // List documents
  ipcMain.handle("libreoffice:list", async (_, query?: DocumentListQuery) => {
    return manager.listDocuments(query);
  });

  // Get document
  ipcMain.handle("libreoffice:get", async (_, id: number) => {
    return manager.getDocument(id);
  });

  // Delete document
  ipcMain.handle("libreoffice:delete", async (_, id: number) => {
    return manager.deleteDocument(id);
  });

  // Export document
  ipcMain.handle("libreoffice:export", async (_, request: ExportDocumentRequest) => {
    return manager.exportDocument(request);
  });

  // Open document in LibreOffice
  ipcMain.handle("libreoffice:open", async (_, id: number) => {
    return manager.openDocument(id);
  });

  // Get documents directory
  ipcMain.handle("libreoffice:get-directory", async () => {
    return manager.getDocumentsDirectory();
  });
}

export { LibreOfficeManager };
