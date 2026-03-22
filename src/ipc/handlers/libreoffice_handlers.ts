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
  DocumentSection,
  SpreadsheetContent,
  SpreadsheetCell,
  PresentationContent,
  PresentationSlide,
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
  private headlessProfileDir: string;

  private constructor() {
    this.documentsDir = path.join(app.getPath("userData"), "documents");
    // Separate profile directory for headless operations to avoid locking
    // conflicts with any running LibreOffice GUI instance
    this.headlessProfileDir = path.join(app.getPath("userData"), "libreoffice-headless-profile");
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
      await fs.mkdir(this.headlessProfileDir, { recursive: true });
    } catch (error) {
      console.error("Failed to create documents directories:", error);
    }
  }

  /**
   * Get the -env:UserInstallation argument for headless operations.
   * This prevents profile lock conflicts when LibreOffice GUI is running.
   */
  private getHeadlessProfileArg(): string {
    // Convert Windows path to file:/// URL format with proper encoding
    let profileUrl = this.headlessProfileDir
      .replace(/\\/g, "/");
    
    // Extract drive letter prefix on Windows (e.g., "C:")
    let drivePrefix = "";
    const driveMatch = profileUrl.match(/^([A-Za-z]:)/);
    if (driveMatch) {
      drivePrefix = `/${driveMatch[1]}`;
      profileUrl = profileUrl.slice(driveMatch[0].length);
    }
    
    // Encode each path segment to handle spaces and special characters
    const encodedPath = profileUrl
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    
    return `-env:UserInstallation=file://${drivePrefix}${encodedPath}`;
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
          this.libreOfficePath = stdout.trim().split("\n")[0].trim();
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

    // Windows: Try to find via Registry
    if (platform === "win32") {
      try {
        const regCmd = 'reg query "HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath" /ve 2>nul';
        const { stdout } = await execAsync(regCmd, { windowsHide: true });
        const match = stdout.match(/REG_SZ\s+(.+)/i);
        if (match) {
          const regPath = match[1].trim();
          for (const exe of ["soffice.com", "soffice.exe"]) {
            const candidate = path.join(regPath, exe);
            try {
              await fs.access(candidate);
              this.libreOfficePath = candidate;
              return candidate;
            } catch {
              continue;
            }
          }
        }
      } catch {
        // Registry key not found
      }
    }

    return null;
  }

  /**
   * Force re-detection of LibreOffice (clears cached path).
   * Useful when user installs LibreOffice while the app is running.
   */
  resetDetection(): void {
    this.libreOfficePath = null;
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
      // Use --headless with a separate user profile to prevent conflicts
      // with any running LibreOffice GUI instance (profile lock issue)
      const profileArg = this.getHeadlessProfileArg();
      // On Windows, avoid quoting the -env: argument — cmd.exe quote
      // handling can interfere with LibreOffice's argument parsing.
      const versionCmd = process.platform === "win32" 
        ? `"${loPath}" --headless ${profileArg} --version < nul`
        : `"${loPath}" --headless ${profileArg} --version < /dev/null`;
      
      const { stdout } = await execAsync(versionCmd, { 
        windowsHide: true,
        timeout: 30000, // 30 second timeout to allow profile init on first run
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
      // Version check failed (possibly timeout, profile lock, etc.)
      // but LibreOffice binary exists — still report as available
      console.warn("LibreOffice version check failed, but binary found:", error);
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
        message: "LibreOffice found but headless check timed out. If exports fail, try closing any open LibreOffice windows.",
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
      let documentContent: DocumentContent | SpreadsheetContent | PresentationContent | undefined = request.content;
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
        content = this.generateDocumentXML(documentContent as DocumentContent);
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
          description: (documentContent && 'metadata' in documentContent ? (documentContent as { metadata?: Record<string, string> }).metadata?.description : undefined) || request.aiGenerate?.prompt || null,
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
  ): Promise<{ content: DocumentContent | SpreadsheetContent | PresentationContent; model: string }> {
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
      // Return basic content structure if AI fails — type-specific fallbacks
      if (type === "spreadsheet") {
        return {
          content: {
            sheets: [{
              name: "Sheet1",
              cells: [
                { row: 1, col: "A", value: "Item" },
                { row: 1, col: "B", value: "Value" },
                { row: 2, col: "A", value: name },
                { row: 2, col: "B", value: options.prompt || "" },
              ],
            }],
          } as SpreadsheetContent,
          model: "fallback",
        };
      }
      if (type === "presentation") {
        return {
          content: {
            slides: [
              { layout: "title" as const, title: name, subtitle: options.prompt },
              { layout: "content" as const, title: "Overview", content: [
                { type: "paragraph" as const, content: options.prompt || "Content goes here." },
              ]},
            ],
          } as PresentationContent,
          model: "fallback",
        };
      }
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

    if (type === "spreadsheet") {
      return `You are an expert spreadsheet creator. Generate tabular data.
Tone: ${tone}
Length: ${length}

IMPORTANT: Output your response as a markdown table. The first row is the header row.
Use standard markdown table syntax with | separators.
Include at least 5-10 data rows with realistic data. More rows for "long" or "detailed" length.

Example:
| Name | Department | Salary | Start Date |
|------|-----------|--------|------------|
| Alice Johnson | Engineering | 95000 | 2023-01-15 |
| Bob Smith | Marketing | 72000 | 2022-06-01 |
| Carol Davis | Sales | 68000 | 2024-03-10 |

Output ONLY the markdown table. No other text, explanations, or formatting.`;
    }

    if (type === "presentation") {
      return `You are an expert presentation creator. Generate slide content.
Tone: ${tone}
Length: ${length}

IMPORTANT: Output your response in this exact format. Each slide starts with "## SLIDE:" followed by the slide title.
Under each slide, add bullet points with "- " prefix for content.
Optionally add "NOTES:" at the end of a slide for speaker notes.

Generate 5-8 slides for a complete presentation.

Example:
## SLIDE: Introduction
- Welcome to this presentation
- Overview of key topics
- Goals and objectives
NOTES: Greet the audience and set expectations.

## SLIDE: Key Findings
- Revenue increased by 25%
- Customer satisfaction at 92%
- Market share grew 5 points
NOTES: Emphasize the revenue growth.

## SLIDE: Conclusion
- Summary of achievements
- Next steps and action items
- Questions and discussion

Output ONLY the slides in this format. No other text.`;
    }

    // Default: document
    return `You are an expert document creator. Generate content in a structured format.
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

PARAGRAPH: Conclusion text here.

You are creating a text document. Include headings, paragraphs, and lists as appropriate.`;
  }

  /**
   * Parse AI response into the correct content structure based on document type.
   */
  private parseAIResponseToContent(type: DocumentType, text: string, options: AIGenerationOptions): DocumentContent | SpreadsheetContent | PresentationContent {
    if (type === "spreadsheet") {
      return this.parseSpreadsheetResponse(text, options);
    }
    if (type === "presentation") {
      return this.parsePresentationResponse(text, options);
    }
    return this.parseDocumentResponse(text, options);
  }

  /**
   * Parse AI response into SpreadsheetContent with actual cell data.
   */
  private parseSpreadsheetResponse(text: string, options: AIGenerationOptions): SpreadsheetContent {
    const cells: SpreadsheetCell[] = [];
    const lines = text.split("\n");
    
    // Find markdown table rows (lines containing |)
    const tableLines = lines.filter(l => l.trim().startsWith("|") && l.trim().endsWith("|"));
    
    // Filter out separator rows (|---|---|)
    const dataLines = tableLines.filter(l => !l.match(/^\|[\s-:|]+\|$/));
    
    if (dataLines.length === 0) {
      // Fallback: try to extract any structured data from the text
      // Split by lines and treat as CSV-like data
      const fallbackLines = lines.filter(l => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("```"));
      let row = 1;
      for (const line of fallbackLines) {
        // Try comma or tab separated
        const parts = line.includes("\t") ? line.split("\t") : line.split(",");
        if (parts.length >= 2) {
          const colLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
          parts.forEach((val, i) => {
            if (i < 26) {
              const trimVal = val.trim();
              if (trimVal) {
                const numVal = Number(trimVal);
                cells.push({
                  row,
                  col: colLetters[i],
                  value: !isNaN(numVal) && trimVal !== "" ? numVal : trimVal,
                });
              }
            }
          });
          row++;
        }
      }
      
      // If still nothing, create a basic spreadsheet from the prompt
      if (cells.length === 0) {
        cells.push({ row: 1, col: "A", value: "Data" });
        cells.push({ row: 1, col: "B", value: "Value" });
        cells.push({ row: 2, col: "A", value: options.prompt?.slice(0, 30) || "Item 1" });
        cells.push({ row: 2, col: "B", value: "" });
      }
      
      return { sheets: [{ name: "Sheet1", cells }] };
    }
    
    // Parse markdown table rows
    const colLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let row = 1;
    for (const line of dataLines) {
      // Split by | and extract cell values
      const rawCells = line.split("|").slice(1, -1); // Remove first/last empty from leading/trailing |
      rawCells.forEach((val, i) => {
        if (i < 26) {
          const trimVal = val.trim();
          if (trimVal) {
            // Try to parse as number
            const cleaned = trimVal.replace(/[$,]/g, "").trim();
            const numVal = Number(cleaned);
            cells.push({
              row,
              col: colLetters[i],
              value: !isNaN(numVal) && cleaned !== "" && !/^\d{4}-\d{2}/.test(trimVal) ? numVal : trimVal,
            });
          }
        }
      });
      row++;
    }

    return { sheets: [{ name: "Sheet1", cells }] };
  }

  /**
   * Parse AI response into PresentationContent with actual slides.
   */
  private parsePresentationResponse(text: string, options: AIGenerationOptions): PresentationContent {
    const slides: PresentationSlide[] = [];
    const lines = text.split("\n");
    
    let currentSlide: PresentationSlide | null = null;
    let currentContent: DocumentSection[] = [];
    let currentNotes = "";
    let collectingNotes = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // New slide marker
      if (trimmed.match(/^##\s*(SLIDE:?|Slide:?)\s*/)) {
        // Save previous slide
        if (currentSlide) {
          currentSlide.content = currentContent;
          currentSlide.notes = currentNotes || undefined;
          slides.push(currentSlide);
        }
        
        const title = trimmed.replace(/^##\s*(SLIDE:?|Slide:?)\s*/, "").trim();
        currentSlide = {
          layout: slides.length === 0 ? "title" : "content",
          title: title,
        };
        currentContent = [];
        currentNotes = "";
        collectingNotes = false;
      } else if (trimmed.match(/^NOTES?:/i)) {
        collectingNotes = true;
        const noteText = trimmed.replace(/^NOTES?:\s*/i, "");
        if (noteText) currentNotes = noteText;
      } else if (collectingNotes && trimmed && !trimmed.startsWith("##")) {
        currentNotes += (currentNotes ? " " : "") + trimmed;
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        collectingNotes = false;
        const bulletText = trimmed.replace(/^[-*]\s*/, "");
        if (bulletText) {
          currentContent.push({
            type: "paragraph",
            content: bulletText,
          });
        }
      } else if (trimmed.match(/^\d+\.\s/)) {
        collectingNotes = false;
        const itemText = trimmed.replace(/^\d+\.\s*/, "");
        if (itemText) {
          currentContent.push({
            type: "paragraph",
            content: itemText,
          });
        }
      } else if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```") && trimmed.length > 3) {
        if (!collectingNotes && currentSlide) {
          currentContent.push({
            type: "paragraph",
            content: trimmed,
          });
        }
      }
    }
    
    // Save last slide
    if (currentSlide) {
      currentSlide.content = currentContent;
      currentSlide.notes = currentNotes || undefined;
      slides.push(currentSlide);
    }
    
    // Fallback: if no slides parsed, create slides from paragraphs
    if (slides.length === 0) {
      const fallbackLines = text.split("\n").filter(l => l.trim());
      const titleLine = fallbackLines[0] || options.prompt || "Presentation";
      slides.push({
        layout: "title",
        title: titleLine.replace(/^#+ */, ""),
        subtitle: options.prompt,
      });
      
      // Group remaining content into slides of ~4 bullets each
      const contentLines = fallbackLines.slice(1).filter(l => !l.startsWith("#") && l.trim().length > 5);
      for (let i = 0; i < contentLines.length; i += 4) {
        const chunk = contentLines.slice(i, i + 4);
        slides.push({
          layout: "content",
          title: `Section ${Math.floor(i / 4) + 1}`,
          content: chunk.map(c => ({
            type: "paragraph" as const,
            content: c.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""),
          })),
        });
      }
    }

    return { slides };
  }

  /**
   * Parse AI response into DocumentContent (for text documents).
   */
  private parseDocumentResponse(text: string, options: AIGenerationOptions): DocumentContent {
    const sections: DocumentContent["sections"] = [];
    const lines = text.split("\n").filter(l => l.trim());

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith("## HEADING:")) {
        sections.push({
          type: "heading",
          level: 1,
          content: trimmed.replace(/^## HEADING:\s*/, ""),
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
        sections.push({
          type: "paragraph",
          content: trimmed,
        });
      }
    }

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
      const usedCols = new Set<string>();
      for (const cell of sheet.cells) {
        if (!rowMap.has(cell.row)) {
          rowMap.set(cell.row, new Map());
        }
        rowMap.get(cell.row)!.set(cell.col, cell);
        usedCols.add(cell.col);
      }

      // Determine column range (A through max used column)
      const allCols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      let maxColIndex = 0;
      for (const col of usedCols) {
        const idx = allCols.indexOf(col);
        if (idx > maxColIndex) maxColIndex = idx;
      }
      const colRange = allCols.slice(0, maxColIndex + 1);
      
      // Add column definitions
      for (const col of colRange) {
        sheetContent += `  <table:table-column/>\n`;
      }

      const maxRow = rowMap.size > 0 ? Math.max(...Array.from(rowMap.keys())) : 0;
      for (let r = 1; r <= maxRow; r++) {
        sheetContent += `  <table:table-row>\n`;
        const rowCells = rowMap.get(r) || new Map();
        for (const col of colRange) {
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
      
      // Title frame
      if (slide.title) {
        const titleY = slide.layout === "title" ? "6cm" : "0.962cm";
        const titleH = slide.layout === "title" ? "4cm" : "3.506cm";
        slideContent += `  <draw:frame draw:style-name="gr1" draw:layer="layout" svg:width="25.4cm" svg:height="${titleH}" svg:x="1.4cm" svg:y="${titleY}">
    <draw:text-box>
      <text:p text:style-name="Title">${this.escapeXML(slide.title)}</text:p>
    </draw:text-box>
  </draw:frame>\n`;
      }
      
      // Subtitle frame
      if (slide.subtitle) {
        const subY = slide.layout === "title" ? "10.5cm" : "5cm";
        slideContent += `  <draw:frame draw:style-name="gr2" draw:layer="layout" svg:width="25.4cm" svg:height="1.8cm" svg:x="1.4cm" svg:y="${subY}">
    <draw:text-box>
      <text:p text:style-name="Subtitle">${this.escapeXML(slide.subtitle)}</text:p>
    </draw:text-box>
  </draw:frame>\n`;
      }

      // Content body — all bullet points in one text box
      if (slide.content && slide.content.length > 0) {
        const contentY = slide.subtitle ? "7cm" : "5cm";
        const contentH = slide.subtitle ? "11cm" : "13cm";
        let bulletParagraphs = "";
        for (const section of slide.content) {
          const text = section.content as string;
          bulletParagraphs += `      <text:p text:style-name="Text_20_body">\u2022 ${this.escapeXML(text)}</text:p>\n`;
        }
        slideContent += `  <draw:frame draw:style-name="gr3" draw:layer="layout" svg:width="25.4cm" svg:height="${contentH}" svg:x="1.4cm" svg:y="${contentY}">
    <draw:text-box>
${bulletParagraphs}    </draw:text-box>
  </draw:frame>\n`;
      }

      // Speaker notes
      if (slide.notes) {
        slideContent += `  <presentation:notes>\n`;
        slideContent += `    <draw:frame draw:style-name="gr4" draw:layer="layout" svg:width="17.271cm" svg:height="12.572cm" svg:x="2.159cm" svg:y="13cm">\n`;
        slideContent += `      <draw:text-box>\n`;
        slideContent += `        <text:p>${this.escapeXML(slide.notes)}</text:p>\n`;
        slideContent += `      </draw:text-box>\n`;
        slideContent += `    </draw:frame>\n`;
        slideContent += `  </presentation:notes>\n`;
      }

      slideContent += `</draw:page>\n`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.2">
  <office:automatic-styles>
    <style:style style:name="dp1" style:family="drawing-page"/>
    <style:style style:name="gr1" style:family="graphic">
      <style:graphic-properties draw:stroke="none" draw:fill="none"/>
    </style:style>
    <style:style style:name="gr2" style:family="graphic">
      <style:graphic-properties draw:stroke="none" draw:fill="none"/>
    </style:style>
    <style:style style:name="gr3" style:family="graphic">
      <style:graphic-properties draw:stroke="none" draw:fill="none"/>
    </style:style>
    <style:style style:name="gr4" style:family="graphic">
      <style:graphic-properties draw:stroke="none" draw:fill="none"/>
    </style:style>
  </office:automatic-styles>
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

      // Use LibreOffice headless to convert, with a separate user profile
      // to avoid conflicts with any running LibreOffice GUI instance
      const filter = EXPORT_FILTERS[request.format] || "writer_pdf_Export";
      
      await new Promise<void>((resolve, reject) => {
        const args = [
          "--headless",
          this.getHeadlessProfileArg(),
          "--convert-to",
          `${request.format}:${filter}`,
          "--outdir",
          outputDir,
          doc.filePath,
        ];

        const proc = spawn(loPath, args, { windowsHide: true });
        
        // Timeout to prevent hanging if LibreOffice gets stuck
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error("LibreOffice export timed out after 60 seconds. Try closing any open LibreOffice windows and retry."));
        }, 60000);

        proc.on("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`LibreOffice exited with code ${code}. If LibreOffice GUI is open, try closing it and retry.`));
          }
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
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

  // Force re-detect LibreOffice (clears cached path)
  ipcMain.handle("libreoffice:refresh-status", async () => {
    manager.resetDetection();
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
