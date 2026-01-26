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
  content: z.string().describe("The main content/text for the document"),
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
  description: "Create a document, spreadsheet, or presentation that can be viewed in Libre Studio. Use this for creating Word documents, Excel spreadsheets, or PowerPoint presentations.",
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

      // Generate document content
      let xmlContent: string;
      
      if (args.type === "document") {
        xmlContent = generateDocumentXML(args.name, args.content);
      } else if (args.type === "spreadsheet") {
        xmlContent = generateSpreadsheetXML(args.name, args.content);
      } else {
        xmlContent = generatePresentationXML(args.name, args.content);
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
