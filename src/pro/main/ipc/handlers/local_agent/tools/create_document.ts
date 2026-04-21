import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import * as fs from "fs/promises";
import * as path from "path";
import { app } from "electron";
import AdmZip from "adm-zip";

const logger = log.scope("create_document");

const documentTypeSchema = z.enum(["document", "spreadsheet", "presentation"]);

const createDocumentSchema = z.object({
  name: z.string().describe("The name of the document"),
  type: documentTypeSchema.describe("The type of document: 'document' for Word-like docs, 'spreadsheet' for Excel-like sheets, 'presentation' for PowerPoint-like slides"),
  content: z.string().describe("The FULL, COMPLETE content to put in the document. For documents: write all paragraphs, headings, and body text. For spreadsheets: use tab-separated or pipe-separated values. For presentations: write full slide content separated by --- dividers. IMPORTANT: Do NOT pass a prompt or outline — write the entire finished content yourself before calling this tool."),
  description: z.string().optional().describe("Brief description of the document"),
});

type DocumentType = z.infer<typeof documentTypeSchema>;

const FORMAT_EXTENSIONS: Record<DocumentType, string> = {
  document: "odt",
  spreadsheet: "ods",
  presentation: "odp",
};

export const createDocumentTool: ToolDefinition<z.infer<typeof createDocumentSchema>> = {
  name: "create_document",
  description: "Create a document, spreadsheet, or presentation that can be viewed in Libre Studio. IMPORTANT: You MUST write the full, complete content yourself before calling this tool. Do NOT pass a prompt, outline, or instructions as the content — write every paragraph, heading, and section with real text. The content field should contain the finished document text, not a description of what to write. If the user asks for a research paper, YOU write the entire paper and pass it as content.",
  inputSchema: createDocumentSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => `Create ${args.type}: ${args.name}`,

  buildXml: (args, isComplete) => {
    if (!args.name) return undefined;

    const typeLabel = args.type === "document" ? "Document" : 
                      args.type === "spreadsheet" ? "Spreadsheet" : "Presentation";
    
    let xml = `<joy-document type="${escapeXmlAttr(args.type || "document")}" name="${escapeXmlAttr(args.name)}" description="${escapeXmlAttr(args.description ?? "")}">`;
    if (isComplete) {
      xml += `</joy-document>`;
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const db = getDb();
    const documentsDir = path.join(app.getPath("userData"), "documents");
    
    try {
      // Ensure documents directory exists
      await fs.mkdir(documentsDir, { recursive: true });

      const format = FORMAT_EXTENSIONS[args.type];
      const fileName = `${args.name.replace(/[^a-zA-Z0-9-_]/g, "_")}_${Date.now()}.${format}`;
      const filePath = path.join(documentsDir, fileName);

      let finalContent = args.content;

      // Detect if the bot passed a prompt/outline instead of actual content.
      // Heuristic: if the content looks like generation instructions (contains
      // numbered section headings with word-count targets, or explicit meta-
      // instructions like "PAPER STRUCTURE" / "REQUIREMENTS" / "generate"),
      // run it through the AI document generation pipeline.
      const looksLikePrompt =
        /\b(PAPER STRUCTURE|REQUIREMENTS|generate|produce|create a comprehensive|8000\+ words|word count|TECHNICAL DEPTH)\b/i.test(finalContent) &&
        finalContent.length > 1500;

      if (looksLikePrompt) {
        logger.info("Detected prompt-style content — routing through AI document generation pipeline");
        try {
          const { LibreOfficeManager } = require("@/ipc/handlers/libreoffice_handlers");
          const manager = LibreOfficeManager.getInstance();
          const result = await manager.createDocument({
            name: args.name,
            type: args.type,
            aiGenerate: {
              prompt: finalContent,
              tone: "professional",
              length: "detailed",
            },
          });
          if (result.success && result.document) {
            ctx.onXmlComplete(
              `<joy-document type="${escapeXmlAttr(args.type)}" name="${escapeXmlAttr(args.name)}" id="${result.document.id}" description="${escapeXmlAttr(args.description ?? "")}"></joy-document>`
            );
            const typeLabel = args.type === "document" ? "Document" : args.type === "spreadsheet" ? "Spreadsheet" : "Presentation";
            return `Successfully created ${typeLabel} "${args.name}" (ID: ${result.document.id}) using AI generation. The user can view it in Libre Studio.`;
          }
          // If AI generation failed, fall through to direct content approach
          logger.warn("AI generation failed, falling back to direct content");
        } catch (aiError) {
          logger.warn("AI generation pipeline unavailable, using direct content:", aiError);
        }
      }

      // Generate document content directly from the provided text
      let xmlContent: string;
      
      if (args.type === "document") {
        xmlContent = generateDocumentXML(args.name, finalContent);
      } else if (args.type === "spreadsheet") {
        xmlContent = generateSpreadsheetXML(args.name, finalContent);
      } else {
        xmlContent = generatePresentationXML(args.name, finalContent);
      }

      // Create ODF file (which is a ZIP archive)
      await writeODFDocument(filePath, args.type, xmlContent);

      // Insert into database
      const [doc] = await db
        .insert(documents)
        .values({
          name: args.name,
          type: args.type,
          format: format,
          status: "ready",
          filePath: filePath,
          description: args.description || null,
          aiPrompt: args.content,
          aiModel: "agent",
        })
        .returning();

      logger.log(`Successfully created document: ${filePath}`);

      // Output XML with document link
      const typeLabel = args.type === "document" ? "Document" : 
                        args.type === "spreadsheet" ? "Spreadsheet" : "Presentation";
      
      ctx.onXmlComplete(
        `<joy-document type="${escapeXmlAttr(args.type)}" name="${escapeXmlAttr(args.name)}" id="${doc.id}" description="${escapeXmlAttr(args.description ?? "")}"></joy-document>`
      );

      return `Successfully created ${typeLabel} "${args.name}" (ID: ${doc.id}). The user can view it in Libre Studio.`;
    } catch (error) {
      logger.error("Failed to create document:", error);
      throw error;
    }
  },
};

function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateDocumentXML(title: string, content: string): string {
  // Parse content into paragraphs
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
  
  let body = `<text:p text:style-name="Title">${escapeXML(title)}</text:p>\n`;
  
  for (const para of paragraphs) {
    const lines = para.split(/\n/).filter(l => l.trim());
    for (const line of lines) {
      // Check for headings (lines starting with # or ##)
      if (line.startsWith("## ")) {
        body += `<text:h text:style-name="Heading_2" text:outline-level="2">${escapeXML(line.replace(/^##\s*/, ""))}</text:h>\n`;
      } else if (line.startsWith("# ")) {
        body += `<text:h text:style-name="Heading_1" text:outline-level="1">${escapeXML(line.replace(/^#\s*/, ""))}</text:h>\n`;
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        body += `<text:p text:style-name="Text_20_body">• ${escapeXML(line.replace(/^[-*]\s*/, ""))}</text:p>\n`;
      } else {
        body += `<text:p text:style-name="Text_20_body">${escapeXML(line)}</text:p>\n`;
      }
    }
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

function generateSpreadsheetXML(title: string, content: string): string {
  // Parse content as rows (one per line), columns separated by | or tabs
  const lines = content.split(/\n/).filter(l => l.trim());
  
  let rows = "";
  for (const line of lines) {
    const cells = line.split(/\t|\|/).map(c => c.trim()).filter(c => c);
    rows += `  <table:table-row>\n`;
    for (const cell of cells) {
      const isNumber = !isNaN(Number(cell));
      if (isNumber) {
        rows += `    <table:table-cell office:value-type="float" office:value="${cell}"><text:p>${escapeXML(cell)}</text:p></table:table-cell>\n`;
      } else {
        rows += `    <table:table-cell office:value-type="string"><text:p>${escapeXML(cell)}</text:p></table:table-cell>\n`;
      }
    }
    rows += `  </table:table-row>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  office:version="1.2">
  <office:body>
    <office:spreadsheet>
      <table:table table:name="${escapeXML(title)}">
        ${rows}
      </table:table>
    </office:spreadsheet>
  </office:body>
</office:document-content>`;
}

function generatePresentationXML(title: string, content: string): string {
  // Parse content into slides (separated by ---) or treat each paragraph as a slide
  const slideContents = content.includes("---") 
    ? content.split(/\n---\n/).map(s => s.trim())
    : content.split(/\n\n+/).map(s => s.trim());
  
  let slides = "";
  
  // Title slide
  slides += `<draw:page draw:name="Title" draw:style-name="dp1">
    <draw:frame draw:style-name="gr1" draw:layer="layout" svg:width="25.4cm" svg:height="3.629cm" svg:x="1.27cm" svg:y="6.356cm">
      <draw:text-box>
        <text:p text:style-name="P1">${escapeXML(title)}</text:p>
      </draw:text-box>
    </draw:frame>
  </draw:page>\n`;

  // Content slides
  for (let i = 0; i < slideContents.length; i++) {
    const slideContent = slideContents[i];
    const lines = slideContent.split(/\n/).filter(l => l.trim());
    const slideTitle = lines[0]?.replace(/^#*\s*/, "") || `Slide ${i + 2}`;
    const bulletPoints = lines.slice(1).map(l => l.replace(/^[-*]\s*/, ""));

    slides += `<draw:page draw:name="Slide${i + 2}" draw:style-name="dp1">
    <draw:frame draw:style-name="gr2" draw:layer="layout" svg:width="25.4cm" svg:height="2cm" svg:x="1.27cm" svg:y="1cm">
      <draw:text-box>
        <text:p text:style-name="P2">${escapeXML(slideTitle)}</text:p>
      </draw:text-box>
    </draw:frame>
    <draw:frame draw:style-name="gr3" draw:layer="layout" svg:width="23cm" svg:height="12cm" svg:x="2cm" svg:y="4cm">
      <draw:text-box>
        ${bulletPoints.map(p => `<text:p text:style-name="P3">• ${escapeXML(p)}</text:p>`).join("\n        ")}
      </draw:text-box>
    </draw:frame>
  </draw:page>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.2">
  <office:body>
    <office:presentation>
      ${slides}
    </office:presentation>
  </office:body>
</office:document-content>`;
}

async function writeODFDocument(filePath: string, type: DocumentType, contentXml: string): Promise<void> {
  const zip = new AdmZip();

  // Add mimetype (must be first and uncompressed)
  const mimeTypes: Record<DocumentType, string> = {
    document: "application/vnd.oasis.opendocument.text",
    spreadsheet: "application/vnd.oasis.opendocument.spreadsheet",
    presentation: "application/vnd.oasis.opendocument.presentation",
  };
  zip.addFile("mimetype", Buffer.from(mimeTypes[type]));

  // Add content.xml
  zip.addFile("content.xml", Buffer.from(contentXml, "utf-8"));

  // Add minimal manifest
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${mimeTypes[type]}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  zip.addFile("META-INF/manifest.xml", Buffer.from(manifest, "utf-8"));

  // Write the zip file
  await fs.writeFile(filePath, zip.toBuffer());
}
