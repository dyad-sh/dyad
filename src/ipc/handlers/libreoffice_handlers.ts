/**
 * LibreOffice Headless Integration Handlers
 * Handles document creation, editing, and export via LibreOffice
 */

import { ipcMain, app, shell } from "electron";
import { spawn, exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { getDb } from "@/db";
import { documents, documentTemplates } from "@/db/schema";
import { eq, desc, like, and, or } from "drizzle-orm";
import { generateText } from "ai";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { readSettings } from "../../main/settings";
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
    "C:\\Program Files\\LibreOffice\\program\\soffice.com",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
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
  xml: "", // Handled natively
  json: "", // Handled natively
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
        const { stdout } = await execAsync("where soffice.exe 2>nul", { windowsHide: true });
        if (stdout.trim()) {
          this.libreOfficePath = stdout.trim().split("\n")[0];
          return this.libreOfficePath;
        }
      } else {
        const { stdout } = await execAsync("which soffice 2>/dev/null || which libreoffice 2>/dev/null", { windowsHide: true });
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
    
    // Native capabilities always available
    const nativeCapabilities = {
      createDocuments: true,      // Native ODF creation
      exportToCsv: true,          // Native CSV export
      exportToTxt: true,          // Native TXT export
      exportToJson: true,         // Native JSON export
      exportToXml: true,          // Native XML export
    };
    
    if (!loPath) {
      return {
        installed: false,
        headlessSupport: false,
        capabilities: {
          ...nativeCapabilities,
          editInLibreOffice: false,
          exportToPdf: false,
          exportToDocx: false,
          exportToXlsx: false,
        },
        message: "LibreOffice not installed. You can still create documents and export to CSV, TXT, JSON, and XML formats. Install LibreOffice for PDF, DOCX, and XLSX export.",
      };
    }

    try {
      // Use --headless to prevent "Press Enter to continue" prompt on Windows
      // Also pipe from nul/dev/null to prevent stdin waiting
      const versionCmd = process.platform === "win32" 
        ? `"${loPath}" --headless --version < nul`
        : `"${loPath}" --version < /dev/null`;
      
      const { stdout } = await execAsync(versionCmd, { 
        windowsHide: true,
        timeout: 10000, // 10 second timeout to prevent hanging
      });
      const versionMatch = stdout.match(/LibreOffice\s+([\d.]+)/);
      
      return {
        installed: true,
        version: versionMatch ? versionMatch[1] : "unknown",
        path: loPath,
        headlessSupport: true,
        capabilities: {
          ...nativeCapabilities,
          editInLibreOffice: true,
          exportToPdf: true,
          exportToDocx: true,
          exportToXlsx: true,
        },
        message: `LibreOffice ${versionMatch ? versionMatch[1] : ""} ready. All features available.`,
      };
    } catch (error) {
      // Even if version check fails, LibreOffice exists at the path
      return {
        installed: true,
        path: loPath,
        headlessSupport: true,
        capabilities: {
          ...nativeCapabilities,
          editInLibreOffice: true,
          exportToPdf: true,
          exportToDocx: true,
          exportToXlsx: true,
        },
        message: "LibreOffice found. All features available.",
      };
    }
  }

  async createDocument(
    request: CreateDocumentRequest
  ): Promise<DocumentOperationResult> {
    const db = getDb();
    // Note: LibreOffice is NOT required for document creation.
    // We create native ODF files using adm-zip. LibreOffice is only needed for:
    // - Converting to other formats (docx, xlsx, pdf, etc.)
    // - Opening documents in LibreOffice's editor

    try {
      const format = request.format || FORMAT_EXTENSIONS[request.type];
      const fileName = `${request.name.replace(/[^a-zA-Z0-9-_]/g, "_")}_${Date.now()}.${format}`;
      const filePath = path.join(this.documentsDir, fileName);

      // Generate content with AI if requested
      let documentContent = request.content;
      let aiPromptUsed: string | undefined;
      let aiModelUsed: string | undefined;
      
      if (request.aiGenerate?.prompt) {
        const aiResult = await this.generateDocumentWithAI(
          request.type,
          request.name,
          request.aiGenerate
        );
        documentContent = aiResult.content;
        aiPromptUsed = request.aiGenerate.prompt;
        aiModelUsed = aiResult.model;
      }

      // Create the document based on type
      let content: string;
      
      if (request.type === "document") {
        content = this.generateDocumentXML(documentContent);
      } else if (request.type === "spreadsheet") {
        content = this.generateSpreadsheetXML(documentContent as SpreadsheetContent);
      } else {
        content = this.generatePresentationXML(documentContent as PresentationContent);
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
          description: documentContent?.metadata?.description || request.aiGenerate?.prompt || null,
          aiPrompt: aiPromptUsed,
          aiModel: aiModelUsed,
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

  /**
   * Generate document content using AI
   */
  private async generateDocumentWithAI(
    type: DocumentType,
    name: string,
    options: AIGenerationOptions
  ): Promise<{ content: DocumentContent; model: string }> {
    const settings = readSettings();
    const selectedModel = settings.selectedModel;
    
    const systemPrompt = this.getDocumentGenerationSystemPrompt(type, options);
    const userPrompt = `Create a ${type} titled "${name}" based on this description:\n\n${options.prompt}`;

    try {
      const { modelClient } = await getModelClient(selectedModel, settings);

      const result = await generateText({
        model: modelClient.model,
        system: systemPrompt,
        prompt: userPrompt,
      });

      // Parse AI response into document content structure
      const content = this.parseAIResponseToContent(type, result.text, options);
      
      return {
        content,
        model: `${selectedModel.provider}/${selectedModel.name}`,
      };
    } catch (error) {
      console.error("AI document generation failed:", error);
      // Return basic content structure if AI fails
      return {
        content: {
          title: name,
          sections: [
            { type: "heading", level: 1, content: name },
            { type: "paragraph", content: options.prompt || "Document content goes here." },
          ],
        },
        model: "fallback",
      };
    }
  }

  private getDocumentGenerationSystemPrompt(type: DocumentType, options: AIGenerationOptions): string {
    const tone = options.tone || "professional";
    const length = options.length || "medium";
    
    const basePrompt = `You are an expert document creator. Generate content in a structured format.
Tone: ${tone}
Length: ${length}

IMPORTANT: Output your response in a specific format that can be parsed:
- Start each heading with "## HEADING:" followed by the heading text
- Start each paragraph with "PARAGRAPH:" followed by the paragraph text
- Start each bullet list item with "- LIST:" followed by the item text
- For numbered lists use "1. LIST:" format

Example format:
## HEADING: Introduction
PARAGRAPH: This is the introduction paragraph with detailed content.

## HEADING: Key Points
- LIST: First important point
- LIST: Second important point
1. LIST: Numbered item one
2. LIST: Numbered item two

PARAGRAPH: Conclusion text here.`;

    if (type === "document") {
      return `${basePrompt}\n\nYou are creating a text document. Include headings, paragraphs, and lists as appropriate.`;
    } else if (type === "spreadsheet") {
      return `${basePrompt}\n\nYou are creating a spreadsheet. Structure data in rows and columns. Use "| COL_A | COL_B | COL_C |" format for table data.`;
    } else {
      return `${basePrompt}\n\nYou are creating a presentation. Each "## SLIDE:" marks a new slide. Include a title and bullet points for each slide.`;
    }
  }

  private parseAIResponseToContent(type: DocumentType, text: string, options: AIGenerationOptions): DocumentContent {
    const sections: DocumentContent["sections"] = [];
    const lines = text.split("\n").filter(l => l.trim());

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith("## HEADING:") || trimmed.startsWith("## SLIDE:")) {
        sections.push({
          type: "heading",
          level: 1,
          content: trimmed.replace(/^## (HEADING|SLIDE):\s*/, ""),
        });
      } else if (trimmed.startsWith("### ")) {
        sections.push({
          type: "heading",
          level: 2,
          content: trimmed.replace(/^### /, ""),
        });
      } else if (trimmed.startsWith("PARAGRAPH:")) {
        sections.push({
          type: "paragraph",
          content: trimmed.replace(/^PARAGRAPH:\s*/, ""),
        });
      } else if (trimmed.match(/^[-*]\s*LIST:/)) {
        // Collect consecutive list items
        sections.push({
          type: "paragraph",
          content: "• " + trimmed.replace(/^[-*]\s*LIST:\s*/, ""),
        });
      } else if (trimmed.match(/^\d+\.\s*LIST:/)) {
        sections.push({
          type: "paragraph",
          content: trimmed.replace(/LIST:\s*/, ""),
        });
      } else if (trimmed && !trimmed.startsWith("#") && trimmed.length > 10) {
        // Regular text paragraph
        sections.push({
          type: "paragraph",
          content: trimmed,
        });
      }
    }

    // Ensure we have at least some content
    if (sections.length === 0) {
      sections.push({
        type: "paragraph",
        content: text.slice(0, 500) || "Document content generated by AI.",
      });
    }

    return {
      title: sections[0]?.type === "heading" ? (sections[0].content as string) : options.prompt?.slice(0, 50),
      sections,
      metadata: {
        description: options.prompt,
        generatedBy: "AI",
      },
    };
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

  /**
   * Native CSV export from spreadsheet without LibreOffice
   */
  private async exportSpreadsheetToCsv(filePath: string, outputPath: string): Promise<void> {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);
    const contentXml = zip.readAsText("content.xml");
    
    // Parse spreadsheet data from ODF XML
    const rows: string[][] = [];
    
    // Simple XML parsing for table cells
    const tableRowRegex = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g;
    const tableCellRegex = /<table:table-cell[^>]*>(?:<text:p[^>]*>(.*?)<\/text:p>)?<\/table:table-cell>/g;
    
    let rowMatch;
    while ((rowMatch = tableRowRegex.exec(contentXml)) !== null) {
      const rowContent = rowMatch[1];
      const row: string[] = [];
      
      let cellMatch;
      const cellRegex = /<table:table-cell[^>]*>(?:<text:p[^>]*>(.*?)<\/text:p>)?<\/table:table-cell>/g;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellValue = cellMatch[1] || "";
        row.push(cellValue.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
      }
      
      if (row.length > 0) {
        rows.push(row);
      }
    }
    
    // Convert to CSV
    const csvContent = rows.map(row => 
      row.map(cell => {
        if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(",")
    ).join("\n");
    
    await fs.writeFile(outputPath, csvContent, "utf-8");
  }

  /**
   * Native text export from document without LibreOffice
   */
  private async exportDocumentToTxt(filePath: string, outputPath: string): Promise<void> {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);
    const contentXml = zip.readAsText("content.xml");
    
    // Extract text content from ODF XML
    const paragraphs: string[] = [];
    const paraRegex = /<text:(?:p|h)[^>]*>(.*?)<\/text:(?:p|h)>/g;
    
    let match;
    while ((match = paraRegex.exec(contentXml)) !== null) {
      let text = match[1] || "";
      // Remove nested tags and decode entities
      text = text.replace(/<[^>]+>/g, "");
      text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      if (text.trim()) {
        paragraphs.push(text);
      }
    }
    
    await fs.writeFile(outputPath, paragraphs.join("\n\n"), "utf-8");
  }

  /**
   * Export spreadsheet to JSON format
   */
  private async exportSpreadsheetToJson(filePath: string, outputPath: string): Promise<void> {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);
    const contentXml = zip.readAsText("content.xml");
    
    // Parse spreadsheet data from ODF XML
    const rows: Record<string, string>[] = [];
    const headers: string[] = [];
    
    const tableRowRegex = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g;
    
    let rowIndex = 0;
    let rowMatch;
    while ((rowMatch = tableRowRegex.exec(contentXml)) !== null) {
      const rowContent = rowMatch[1];
      const cells: string[] = [];
      
      const cellRegex = /<table:table-cell[^>]*>(?:<text:p[^>]*>(.*?)<\/text:p>)?<\/table:table-cell>/g;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellValue = cellMatch[1] || "";
        cells.push(cellValue.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
      }
      
      if (cells.length > 0) {
        if (rowIndex === 0) {
          // First row is headers
          headers.push(...cells);
        } else {
          // Data rows
          const row: Record<string, string> = {};
          cells.forEach((cell, i) => {
            const header = headers[i] || `column_${i}`;
            row[header] = cell;
          });
          rows.push(row);
        }
        rowIndex++;
      }
    }
    
    await fs.writeFile(outputPath, JSON.stringify(rows, null, 2), "utf-8");
  }

  /**
   * Export document to structured XML
   */
  private async exportToXml(filePath: string, outputPath: string, docType: DocumentType): Promise<void> {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);
    const contentXml = zip.readAsText("content.xml");
    
    if (docType === "spreadsheet") {
      // Parse spreadsheet to clean XML
      const rows: string[][] = [];
      const tableRowRegex = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g;
      
      let rowMatch;
      while ((rowMatch = tableRowRegex.exec(contentXml)) !== null) {
        const rowContent = rowMatch[1];
        const cells: string[] = [];
        
        const cellRegex = /<table:table-cell[^>]*>(?:<text:p[^>]*>(.*?)<\/text:p>)?<\/table:table-cell>/g;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          const cellValue = cellMatch[1] || "";
          cells.push(this.escapeXML(cellValue.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')));
        }
        
        if (cells.length > 0) {
          rows.push(cells);
        }
      }
      
      const headers = rows[0] || [];
      const dataRows = rows.slice(1);
      
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<dataset>\n';
      for (const row of dataRows) {
        xml += '  <record>\n';
        row.forEach((cell, i) => {
          const tag = headers[i]?.replace(/[^a-zA-Z0-9_]/g, "_") || `field_${i}`;
          xml += `    <${tag}>${cell}</${tag}>\n`;
        });
        xml += '  </record>\n';
      }
      xml += '</dataset>';
      
      await fs.writeFile(outputPath, xml, "utf-8");
    } else {
      // For documents, extract and structure content
      const sections: Array<{ type: string; content: string }> = [];
      const contentRegex = /<text:(p|h)[^>]*>(.*?)<\/text:(p|h)>/g;
      
      let match;
      while ((match = contentRegex.exec(contentXml)) !== null) {
        const type = match[1] === "h" ? "heading" : "paragraph";
        let text = match[2] || "";
        text = text.replace(/<[^>]+>/g, "");
        text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        if (text.trim()) {
          sections.push({ type, content: text.trim() });
        }
      }
      
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<document>\n';
      for (const section of sections) {
        xml += `  <${section.type}>${this.escapeXML(section.content)}</${section.type}>\n`;
      }
      xml += '</document>';
      
      await fs.writeFile(outputPath, xml, "utf-8");
    }
  }

  async exportDocument(request: ExportDocumentRequest): Promise<DocumentOperationResult> {
    const db = getDb();

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
      await fs.mkdir(outputDir, { recursive: true });
      const outputFileName = `${path.basename(doc.filePath, path.extname(doc.filePath))}.${request.format}`;
      const outputPath = path.join(outputDir, outputFileName);

      // Check if we can export natively without LibreOffice
      const canExportNatively = 
        (request.format === "csv" && doc.type === "spreadsheet") ||
        (request.format === "txt" && doc.type === "document") ||
        (request.format === "json" && doc.type === "spreadsheet") ||
        request.format === "xml";

      if (canExportNatively) {
        if (request.format === "csv") {
          await this.exportSpreadsheetToCsv(doc.filePath, outputPath);
        } else if (request.format === "txt") {
          await this.exportDocumentToTxt(doc.filePath, outputPath);
        } else if (request.format === "json") {
          await this.exportSpreadsheetToJson(doc.filePath, outputPath);
        } else if (request.format === "xml") {
          await this.exportToXml(doc.filePath, outputPath, doc.type as DocumentType);
        }
        return { success: true, filePath: outputPath };
      }

      // For other formats, check if LibreOffice is available
      const loPath = await this.findLibreOffice();
      if (!loPath) {
        return {
          success: false,
          error: "LibreOffice is required to export to this format. Please install LibreOffice or export as CSV/TXT/JSON/XML.",
        };
      }

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

        const proc = spawn(loPath, args, { windowsHide: true });
        
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

  async openDocument(id: number): Promise<{ success: boolean; error?: string; alternativeAction?: string }> {
    const db = getDb();
    const loPath = await this.findLibreOffice();

    if (!loPath) {
      // Try to open with system default application instead
      try {
        const [doc] = await db
          .select()
          .from(documents)
          .where(eq(documents.id, id))
          .limit(1);

        if (!doc) {
          return { success: false, error: "Document not found" };
        }

        // Try opening with system default app
        await shell.openPath(doc.filePath);
        return { 
          success: true,
          alternativeAction: "Opened with system default application. Install LibreOffice for better editing support."
        };
      } catch {
        return { 
          success: false, 
          error: "LibreOffice is not installed. Please install LibreOffice to edit documents, or use 'Show in Folder' to open manually.",
          alternativeAction: "show-in-folder"
        };
      }
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

      // Check if file exists
      try {
        await fs.access(doc.filePath);
      } catch {
        return { success: false, error: "Document file not found on disk. It may have been moved or deleted." };
      }

      // Open in LibreOffice
      spawn(loPath, [doc.filePath], { detached: true, stdio: "ignore", windowsHide: true }).unref();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to open document",
      };
    }
  }

  async downloadDocument(id: number): Promise<DocumentOperationResult> {
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

      // Check if source file exists
      try {
        await fs.access(doc.filePath);
      } catch {
        return { success: false, error: "Document file not found on disk" };
      }

      // Copy to Downloads folder
      const downloadsPath = app.getPath("downloads");
      const fileName = path.basename(doc.filePath);
      const destPath = path.join(downloadsPath, fileName);

      // If file exists, add timestamp to avoid overwriting
      let finalDestPath = destPath;
      try {
        await fs.access(destPath);
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        finalDestPath = path.join(downloadsPath, `${base}_${Date.now()}${ext}`);
      } catch {
        // File doesn't exist, use original path
      }

      await fs.copyFile(doc.filePath, finalDestPath);

      // Show in file explorer
      shell.showItemInFolder(finalDestPath);

      return {
        success: true,
        filePath: finalDestPath,
      };
    } catch (error) {
      console.error("Failed to download document:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to download document",
      };
    }
  }

  async showDocumentInFolder(id: number): Promise<{ success: boolean; error?: string }> {
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

      // Check if file exists
      try {
        await fs.access(doc.filePath);
      } catch {
        return { success: false, error: "Document file not found on disk" };
      }

      shell.showItemInFolder(doc.filePath);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to show document",
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

  // Download document (copy to Downloads folder and show in explorer)
  ipcMain.handle("libreoffice:download", async (_, id: number) => {
    return manager.downloadDocument(id);
  });

  // Show document in file explorer
  ipcMain.handle("libreoffice:show-in-folder", async (_, id: number) => {
    return manager.showDocumentInFolder(id);
  });

  // Get documents directory
  ipcMain.handle("libreoffice:get-directory", async () => {
    return manager.getDocumentsDirectory();
  });
}

export { LibreOfficeManager };
