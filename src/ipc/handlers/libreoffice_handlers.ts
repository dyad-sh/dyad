/**
 * LibreOffice Headless Integration Handlers
 * Handles document creation, editing, and export via LibreOffice
 */

import { ipcMain, app, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { spawn, exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { getDb } from "@/db";
import { documents, documentTemplates } from "@/db/schema";
import { eq, desc, like, and, or } from "drizzle-orm";
import { generateText, streamText } from "ai";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { readSettings } from "../../main/settings";
import { smartRouter } from "@/lib/smart_router";
import { safeSend } from "@/ipc/utils/safe_sender";
import { recordAICost } from "@/ipc/utils/cost_tracking";
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
// On Windows, .exe is the GUI binary; .com is the console launcher (for headless/CLI).
const LIBREOFFICE_PATHS = {
  win32: [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files\\LibreOffice\\program\\soffice.com",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
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
  png: "png",
  xml: "", // Handled natively
  json: "", // Handled natively
};

class LibreOfficeManager {
  private static instance: LibreOfficeManager;
  private libreOfficePath: string | null = null;
  private documentsDir: string;
  private headlessProfileDir: string;
  /** Track spawned child processes so we can kill them on shutdown. */
  private activeProcesses: Set<import("child_process").ChildProcess> = new Set();
  /** Number of active consumers (e.g. the documents page). When 0, shutdown is allowed. */
  private refCount = 0;

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
          exportToPng: false,
          exportToDocx: false,
          exportToXlsx: false,
        },
        message: "LibreOffice not installed. You can still create documents and export to CSV, TXT, JSON, and XML formats. Install LibreOffice for PDF, PNG, DOCX, and XLSX export.",
      };
    }

    try {
      // Use --headless with a separate user profile to prevent conflicts
      // with any running LibreOffice GUI instance (profile lock issue).
      // Use spawn() directly (not exec/shell) so no cmd.exe window appears on
      // Windows when using soffice.com (a console-subsystem binary).
      const profileArg = this.getHeadlessProfileArg();
      const stdout = await new Promise<string>((resolve, reject) => {
        const proc = spawn(loPath, ["--headless", profileArg, "--version"], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error("LibreOffice version check timed out after 30 seconds"));
        }, 30000);
        proc.on("close", () => { clearTimeout(timer); resolve(out); });
        proc.on("error", (err) => { clearTimeout(timer); reject(err); });
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
          exportToPng: true,
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
          exportToPng: true,
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

    // Determine which model to use based on routing mode:
    // 1. "smart" — delegate to the Smart Router based on prompt complexity
    // 2. Explicit provider/model — use exactly what the user picked
    // 3. Fallback — prefer documentAiModel from settings, then global selectedModel
    let selectedModel = (settings as Record<string, unknown>).documentAiModel as { provider: string; name: string } | undefined
      ?? settings.selectedModel;

    if (options.routingMode === "smart") {
      try {
        const decision = await smartRouter.route({
          taskType: type === "spreadsheet" ? "extraction" : "creative_writing",
          prompt: options.prompt,
          privacyLevel: "standard",
        });
        selectedModel = { provider: decision.providerId, name: decision.modelId };
      } catch (routeError) {
        console.warn("Smart Router failed, using default model:", routeError);
      }
    } else if (options.provider && options.model) {
      selectedModel = { provider: options.provider, name: options.model };
    }
    
    const systemPrompt = this.getDocumentGenerationSystemPrompt(type, options);
    const userPrompt = this.buildUserPrompt(type, name, options);
    const maxTokens = this.getMaxTokensForLength(options.length);

    try {
      console.log("[DocGen] Selected model:", JSON.stringify(selectedModel));
      console.log("[DocGen] maxOutputTokens:", maxTokens);
      console.log("[DocGen] userPrompt length:", userPrompt.length);
      console.log("[DocGen] systemPrompt length:", systemPrompt.length);
      
      const { modelClient } = await getModelClient(selectedModel, settings);
      console.log("[DocGen] Model client obtained successfully");

      const result = await generateText({
        model: modelClient.model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: maxTokens,
      });

      console.log("[DocGen] generateText result.text length:", result.text?.length);
      console.log("[DocGen] generateText result.text preview:", result.text?.substring(0, 200));
      console.log("[DocGen] generateText finishReason:", (result as Record<string, unknown>).finishReason);
      console.log("[DocGen] generateText usage:", JSON.stringify((result as Record<string, unknown>).usage));

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

  /**
   * Map the user-facing length option to a maxTokens value so the model
   * actually produces long-form content when asked.
   */
  private getMaxTokensForLength(length?: string): number {
    switch (length) {
      case "short":
        return 4096;
      case "medium":
        return 8192;
      case "long":
        return 16384;
      case "detailed":
        return 32768;
      default:
        return 8192;
    }
  }

  /**
   * Build a rich user prompt that provides the AI with context for
   * higher-quality generation.
   */
  private buildUserPrompt(type: DocumentType, name: string, options: AIGenerationOptions): string {
    const length = options.length || "medium";
    const tone = options.tone || "professional";
    const typeLabel = type === "spreadsheet" ? "spreadsheet" : type === "presentation" ? "presentation" : "document";

    let prompt = `Create a ${typeLabel} titled "${name}".`;

    if (options.prompt) {
      prompt += `\n\nDescription and requirements:\n${options.prompt}`;
    }

    prompt += `\n\nAdditional context:`;
    prompt += `\n- Target audience: professionals and stakeholders who expect thorough, high-quality output`;
    prompt += `\n- Quality standard: publication-ready, comparable to what a senior expert would produce`;
    prompt += `\n- Tone: ${tone}`;
    prompt += `\n- Length: ${length} — produce the full amount of content specified in the system instructions`;

    if (type === "document") {
      prompt += `\n- Write in complete, well-developed paragraphs with analysis, evidence, and examples`;
      prompt += `\n- Do NOT produce a brief outline or skeleton — write the full document`;
    } else if (type === "spreadsheet") {
      prompt += `\n- Generate realistic, varied data with proper data types and meaningful headers`;
      prompt += `\n- Include summary/total rows where appropriate`;
    } else if (type === "presentation") {
      prompt += `\n- Write detailed bullet points that are complete thoughts, not just keywords`;
      prompt += `\n- Include speaker notes for every slide`;
    }

    return prompt;
  }

  private getDocumentGenerationSystemPrompt(type: DocumentType, options: AIGenerationOptions): string {
    const tone = options.tone || "professional";
    const length = options.length || "medium";

    const lengthGuidance: Record<string, { rows: string; slides: string; words: string; paragraphDepth: string; sectionsMin: string }> = {
      short: { rows: "10-20", slides: "5-8", words: "800-1200", paragraphDepth: "4-6 sentences", sectionsMin: "3-4" },
      medium: { rows: "20-40", slides: "8-14", words: "2000-3500", paragraphDepth: "5-8 sentences", sectionsMin: "5-7" },
      long: { rows: "40-80", slides: "14-22", words: "4000-7000", paragraphDepth: "6-10 sentences", sectionsMin: "8-12" },
      detailed: { rows: "80-150", slides: "22-35", words: "7000-12000", paragraphDepth: "8-12 sentences", sectionsMin: "12-18" },
    };
    const guide = lengthGuidance[length] || lengthGuidance.medium;

    if (type === "spreadsheet") {
      return `You are a senior data analyst and spreadsheet architect. Your task is to create a professional, publication-ready spreadsheet with rich, realistic data.

Tone: ${tone}
Length: ${length} (generate ${guide.rows} data rows across multiple logical sheets)

REQUIREMENTS — follow every point:

1. **Multiple Sheets**: Output 2-4 separate sheets. Separate each sheet with a line that reads exactly:
   SHEET: <Sheet Name>
   The first sheet is the primary data sheet. Additional sheets can be summaries, breakdowns, or analysis.

2. **Column Design**: Include 5-10 meaningful columns per sheet. Use diverse data types:
   - Text (names, categories, descriptions, statuses)
   - Numbers (quantities, percentages, currencies, scores)
   - Dates (in YYYY-MM-DD format)
   - Calculated/derived columns (totals, margins, growth rates)

3. **Data Quality**: Generate realistic, varied data that tells a story:
   - Use realistic proper nouns (company names, people, cities, products)
   - Include variance and distribution in numeric data — not all values identical
   - Add edge cases (nulls shown as empty cells, outliers, negative values where appropriate)
   - Ensure referential integrity between sheets

4. **Summary Rows**: End data sheets with summary rows using common aggregations:
   - TOTAL, AVERAGE, MIN, MAX rows where appropriate
   - Mark summary rows clearly with labels like "TOTAL" or "AVERAGE" in the first column

5. **Headers**: Make headers descriptive and properly capitalized (e.g., "Annual Revenue ($)" not "rev")

OUTPUT FORMAT: Standard markdown tables with | separators. First row of each table is the header.
Separate sheets with "SHEET: <name>" on its own line before each table.
If only one logical sheet makes sense for the topic, that is acceptable — but always aim for at least ${guide.rows} data rows.

Example:
SHEET: Sales Data
| Salesperson | Region | Q1 Revenue ($) | Q2 Revenue ($) | Units Sold | Win Rate (%) | Start Date |
|-------------|--------|----------------|----------------|------------|--------------|------------|
| Sarah Chen | West | 245000 | 312000 | 156 | 68.5 | 2022-03-15 |
| Marcus Johnson | East | 198000 | 223000 | 132 | 71.2 | 2021-08-01 |
| TOTAL | | 443000 | 535000 | 288 | 69.9 | |

SHEET: Regional Summary
| Region | Total Revenue ($) | Avg Deal Size ($) | Top Product | Growth Rate (%) |
|--------|-------------------|-------------------|-------------|-----------------|
| West | 557000 | 3571 | Enterprise Suite | 27.3 |
| East | 421000 | 3189 | Starter Pack | 12.6 |

Output ONLY the sheet markers and markdown tables. No other text, explanations, or commentary.`;
    }

    if (type === "presentation") {
      return `You are a world-class presentation designer and storytelling expert. Your task is to create a compelling, detailed presentation that rivals the best professional decks.

Tone: ${tone}
Length: ${length} (generate ${guide.slides} slides)

REQUIREMENTS — follow every point:

1. **Narrative Arc**: Structure the presentation with a clear story:
   - Opening: Hook the audience with a compelling insight, question, or statistic
   - Context: Set the stage with background and current state
   - Core Content: Deep-dive into 3-5 key themes with evidence and examples
   - Synthesis: Connect the dots, show implications
   - Closing: Strong conclusion with clear call to action or key takeaways

2. **Slide Content Depth**: Each slide should have substantive, detailed content:
   - 4-8 bullet points per slide
   - Bullet points should be complete thoughts, not just keywords (15-30 words each)
   - Include specific data, metrics, examples, and evidence where relevant
   - Use sub-points (indented with "  - ") for supporting detail beneath main bullets

3. **Slide Variety**: Mix different slide types:
   - Title slide (first slide)
   - Agenda/Overview slide (second slide)
   - Data-driven slides with specific numbers and percentages
   - Comparison/analysis slides
   - Case study or example slides
   - Key takeaways slide (near the end)
   - Q&A or Next Steps slide (final slide)

4. **Speaker Notes**: Add detailed speaker notes to EVERY slide with:
   - Talking points and transitions
   - Additional context not on the slide
   - Timing suggestions (e.g., "spend 2 minutes here")
   - Suggested audience interaction points

5. **Professional Language**: Write with authority and precision. Avoid vague language like "things," "stuff," "various." Use specific domain terminology.

OUTPUT FORMAT:
Each slide starts with "## SLIDE:" followed by the slide title.
Bullet points use "- " prefix. Sub-points use "  - " (two spaces then dash).
Speaker notes start with "NOTES:" after the slide content.

You MUST generate exactly ${guide.slides} slides. Do not output fewer.

Example:
## SLIDE: The $4.2 Trillion Opportunity
- Global digital transformation spending is projected to reach $4.2T by 2027, nearly doubling from 2023 levels
- 73% of enterprise leaders rank digital transformation as their top strategic priority for the next 3 years
- Despite massive investment, only 35% of digital initiatives deliver their projected ROI
  - Common failure points: lack of change management, unclear KPIs, and siloed implementation
  - Companies with integrated strategies see 2.5x higher success rates
- The gap between leaders and laggards is widening: top quartile performers generate 3x more revenue from digital channels
- Key question for today: How do we ensure our organization lands in the top quartile?
NOTES: This opening slide is designed to grab attention with the scale of the opportunity and the stakes involved. Pause after the ROI statistic to let it sink in. Ask the audience: "Where do you think your organization falls?" Spend about 2 minutes on this slide.

## SLIDE: Agenda
- Market landscape and competitive dynamics (10 min)
- Our strategic framework and methodology (15 min)
- Three case studies demonstrating 40-120% improvement (10 min)
- Implementation roadmap and resource requirements (10 min)
- Q&A and next steps (15 min)
NOTES: Walk through the agenda quickly. Mention that you'll leave ample time for questions. Total presentation is approximately 60 minutes.

Output ONLY the slides in this format. No other text.`;
    }

    // Default: document
    return `You are a senior professional writer, researcher, and subject matter expert. Your task is to produce a comprehensive, publication-quality document that matches or exceeds the quality of content from leading AI assistants like Claude or Gemini.

Tone: ${tone}
Length: ${length} — write approximately ${guide.words} words across ${guide.sectionsMin} sections minimum. Each paragraph must be ${guide.paragraphDepth}.

QUALITY REQUIREMENTS — follow every point:

1. **Depth & Substance**: Write with genuine expertise. Every paragraph must contain:
   - Specific facts, data points, or evidence (use realistic figures when the topic warrants it)
   - Analysis and reasoning, not just surface-level description
   - Examples, analogies, or case references to illustrate points
   - Connections between ideas showing how concepts relate

2. **Structure**: Build a well-organized document with clear information hierarchy:
   - Start with an executive summary or introduction that frames the document's purpose
   - Use main headings (## HEADING:) for major sections
   - Use subheadings (### SUBHEADING:) to break down complex sections
   - End with a conclusion, recommendations, or next steps section
   - Include transitional sentences between sections for flow

3. **Paragraph Quality**: Each paragraph must be a fully developed unit of thought (${guide.paragraphDepth}):
   - Open with a clear topic sentence
   - Develop the idea with supporting evidence, examples, or analysis
   - Include nuance — acknowledge complexity, limitations, or alternative perspectives
   - Close with a sentence that connects to the next point or reinforces the key insight

4. **Lists & Data**: When using lists, make them substantive:
   - Each list item should be a complete thought (not just 2-3 words)
   - Include context, rationale, or impact for each item
   - Use numbered lists for sequential or ranked items, bullets for unordered sets

5. **Professional Standards**:
   - Use precise, domain-appropriate terminology
   - Avoid filler words, clichés, and vague language ("various," "things," "really")
   - Maintain consistent voice and tense throughout
   - Include quantitative data where the topic allows
   - Write as if this document will be read by executives, stakeholders, or subject matter experts

OUTPUT FORMAT — use these markers strictly:
- Main headings: ## HEADING: <heading text>
- Subheadings: ### SUBHEADING: <subheading text>
- Paragraphs: PARAGRAPH: <full paragraph text — write the entire paragraph on one line>
- Bullet list items: - LIST: <complete list item with context>
- Numbered list items: 1. LIST: <complete numbered item>

CRITICAL: Write approximately ${guide.words} words total. Do NOT produce a skeleton or outline. Write complete, detailed, publication-ready prose. Every section should have multiple fully-developed paragraphs. The document should be ready to present to stakeholders with no further editing.

Example (showing depth expectations):
## HEADING: Executive Summary
PARAGRAPH: This document presents a comprehensive analysis of the current market dynamics and strategic opportunities facing the organization in fiscal year 2025. Drawing on industry benchmarks, competitive intelligence, and internal performance data, we identify three critical growth vectors that together represent an addressable market expansion of approximately $2.4 billion. The analysis reveals that while the organization maintains strong positioning in its core segments, emerging competitive threats from both traditional rivals and digital-native disruptors require a proactive strategic response within the next 12-18 months.

## HEADING: Market Analysis
### SUBHEADING: Industry Overview
PARAGRAPH: The global market has undergone significant structural transformation over the past three years, driven primarily by accelerated digital adoption, shifting consumer expectations, and evolving regulatory frameworks. According to industry data, the total addressable market grew by 18.3% in 2024, reaching $847 billion globally — marking the fastest expansion in over a decade. However, this growth has been unevenly distributed, with cloud-native and AI-enabled segments capturing nearly 62% of new market value while traditional segments experienced flat or declining growth. This bifurcation has profound implications for strategic planning and resource allocation.
- LIST: Cloud-native solutions captured $312B in new revenue, growing at 34% CAGR over three years, driven by enterprise migration from legacy infrastructure and the rise of multi-cloud architectures
- LIST: Traditional on-premise offerings declined 8.2% year-over-year as organizations accelerate sunset timelines, with mid-market companies leading the transition
1. LIST: Prioritize investment in cloud-native capabilities to capture the dominant growth segment before competitive window narrows
2. LIST: Develop managed migration pathways for existing on-premise customers to prevent churn during the transition period

Write the entire document at this level of quality and detail.`;
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
    const lines = text.split("\n");
    const colLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // Split text into sheet blocks using "SHEET:" markers
    const sheetBlocks: { name: string; lines: string[] }[] = [];
    let currentBlock: { name: string; lines: string[] } = { name: "Sheet1", lines: [] };

    for (const line of lines) {
      const sheetMatch = line.trim().match(/^SHEET:\s*(.+)$/i);
      if (sheetMatch) {
        // Save previous block if it has content
        if (currentBlock.lines.length > 0) {
          sheetBlocks.push(currentBlock);
        }
        currentBlock = { name: sheetMatch[1].trim(), lines: [] };
      } else {
        currentBlock.lines.push(line);
      }
    }
    if (currentBlock.lines.length > 0) {
      sheetBlocks.push(currentBlock);
    }

    // If no sheet markers found, treat entire text as one sheet
    if (sheetBlocks.length === 0) {
      sheetBlocks.push({ name: "Sheet1", lines });
    }

    const sheets: SpreadsheetContent["sheets"] = [];

    for (const block of sheetBlocks) {
      const cells: SpreadsheetCell[] = [];

      // Find markdown table rows (lines containing |)
      const tableLines = block.lines.filter(l => l.trim().startsWith("|") && l.trim().endsWith("|"));
      // Filter out separator rows (|---|---|)
      const dataLines = tableLines.filter(l => !l.match(/^\|[\s-:|]+\|$/));

      if (dataLines.length === 0) {
        // Fallback: try CSV/tab-separated
        const fallbackLines = block.lines.filter(
          l => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("```") && !l.trim().match(/^SHEET:/i)
        );
        let row = 1;
        for (const line of fallbackLines) {
          const parts = line.includes("\t") ? line.split("\t") : line.split(",");
          if (parts.length >= 2) {
            parts.forEach((val, i) => {
              if (i < 26) {
                const trimVal = val.trim();
                if (trimVal) {
                  const cleaned = trimVal.replace(/[$,%]/g, "").trim();
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
        }

        if (cells.length === 0) {
          cells.push({ row: 1, col: "A", value: "Data" });
          cells.push({ row: 1, col: "B", value: "Value" });
          cells.push({ row: 2, col: "A", value: options.prompt?.slice(0, 50) || "Item 1" });
          cells.push({ row: 2, col: "B", value: "" });
        }
      } else {
        // Parse markdown table rows
        let row = 1;
        for (const line of dataLines) {
          const rawCells = line.split("|").slice(1, -1);
          rawCells.forEach((val, i) => {
            if (i < 26) {
              const trimVal = val.trim();
              if (trimVal) {
                const cleaned = trimVal.replace(/[$,%]/g, "").trim();
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
      }

      sheets.push({ name: block.name, cells });
    }

    return { sheets };
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
      
      // New slide marker — accept ## SLIDE:, ## Slide:, or plain ## heading
      const slideMatch = trimmed.match(/^##\s*(SLIDE:?|Slide:?)\s*(.*)/);
      const plainHeadingMatch = !slideMatch && trimmed.match(/^##\s+(.+)/);

      if (slideMatch || plainHeadingMatch) {
        // Save previous slide
        if (currentSlide) {
          currentSlide.content = currentContent;
          currentSlide.notes = currentNotes || undefined;
          slides.push(currentSlide);
        }
        
        const title = slideMatch ? slideMatch[2].trim() : (plainHeadingMatch as RegExpMatchArray)[1].trim();
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
      } else if (line.match(/^\s{2,}[-*]\s+/)) {
        // Indented sub-bullet — append to previous bullet with indent marker
        collectingNotes = false;
        const subText = trimmed.replace(/^[-*]\s*/, "");
        if (subText) {
          currentContent.push({
            type: "paragraph",
            content: "  → " + subText,
          });
        }
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
      
      // Group remaining content into slides of ~6 bullets each
      const contentLines = fallbackLines.slice(1).filter(l => !l.startsWith("#") && l.trim().length > 5);
      for (let i = 0; i < contentLines.length; i += 6) {
        const chunk = contentLines.slice(i, i + 6);
        slides.push({
          layout: "content",
          title: `Section ${Math.floor(i / 6) + 1}`,
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
    const lines = text.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Our explicit format markers (highest priority)
      if (trimmed.startsWith("## HEADING:")) {
        sections.push({
          type: "heading",
          level: 1,
          content: trimmed.replace(/^## HEADING:\s*/, ""),
        });
      } else if (trimmed.match(/^###?\s*SUBHEADING:/)) {
        sections.push({
          type: "heading",
          level: 2,
          content: trimmed.replace(/^###?\s*SUBHEADING:\s*/, ""),
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
      // Flexible markdown fallbacks — handle when AI uses plain markdown
      } else if (trimmed.match(/^#{1,3}\s+/) && !trimmed.includes("HEADING:") && !trimmed.includes("SUBHEADING:")) {
        const hashes = trimmed.match(/^(#+)/)?.[1].length ?? 1;
        sections.push({
          type: "heading",
          level: Math.min(hashes, 2) as 1 | 2,
          content: trimmed.replace(/^#+\s*/, ""),
        });
      } else if (trimmed.match(/^[-*]\s+/) && !trimmed.startsWith("---")) {
        // Plain bullet list item (no LIST: marker)
        sections.push({
          type: "paragraph",
          content: "• " + trimmed.replace(/^[-*]\s+/, ""),
        });
      } else if (trimmed.match(/^\d+\.\s+/)) {
        // Plain numbered list item (no LIST: marker)
        sections.push({
          type: "paragraph",
          content: trimmed,
        });
      } else if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length < 120) {
        // Bold-only line treated as a subheading
        sections.push({
          type: "heading",
          level: 2,
          content: trimmed.replace(/^\*\*|\*\*$/g, ""),
        });
      } else if (trimmed.length > 0) {
        sections.push({
          type: "paragraph",
          content: trimmed,
        });
      }
    }

    if (sections.length === 0) {
      // Use full text as fallback instead of truncating to 500 chars
      sections.push({
        type: "paragraph",
        content: text || "Document content generated by AI.",
      });
    }

    return {
      title: sections[0]?.type === "heading" ? (sections[0].content as string) : options.prompt?.slice(0, 100),
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
      // For PNG, LibreOffice expects just the format name without a filter suffix
      const convertArg = request.format === "png" ? "png" : `${request.format}:${filter}`;
      
      await new Promise<void>((resolve, reject) => {
        const args = [
          "--headless",
          this.getHeadlessProfileArg(),
          "--convert-to",
          convertArg,
          "--outdir",
          outputDir,
          doc.filePath,
        ];

        const proc = spawn(loPath, args, { windowsHide: true });
        this.activeProcesses.add(proc);
        
        // Timeout to prevent hanging if LibreOffice gets stuck
        const timeout = setTimeout(() => {
          proc.kill();
          this.activeProcesses.delete(proc);
          reject(new Error("LibreOffice export timed out after 60 seconds. Try closing any open LibreOffice windows and retry."));
        }, 60000);

        proc.on("close", (code) => {
          clearTimeout(timeout);
          this.activeProcesses.delete(proc);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`LibreOffice exited with code ${code}. If LibreOffice GUI is open, try closing it and retry.`));
          }
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          this.activeProcesses.delete(proc);
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

      // Open in LibreOffice — use .exe for GUI on Windows, never hide the window
      let guiPath = loPath;
      if (process.platform === "win32" && loPath.endsWith("soffice.com")) {
        const exePath = loPath.replace(/soffice\.com$/i, "soffice.exe");
        try {
          await fs.access(exePath);
          guiPath = exePath;
        } catch {
          // fall back to .com
        }
      }
      const child = spawn(guiPath, [doc.filePath], { detached: true, stdio: "ignore" });
      child.on("error", (err) => {
        console.error("[LibreOffice] Failed to spawn:", err.message);
      });
      child.unref();

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

  // ===========================================================================
  // Lifecycle management — LibreOffice should only be running when a consumer
  // (e.g. the Document Studio page) is active or a conversion is in progress.
  // ===========================================================================

  /**
   * Called when a consumer (e.g. documents page) mounts.
   * Increments the reference count and optionally pre-detects LibreOffice.
   */
  async ensureReady(): Promise<LibreOfficeStatus> {
    this.refCount++;
    return this.getStatus();
  }

  /**
   * Called when a consumer unmounts.
   * Decrements the refCount; when zero, kills any orphaned soffice processes
   * that LibreOffice headless may have left behind.
   */
  async shutdown(): Promise<void> {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;

    // 1. Kill any still-tracked child processes
    for (const proc of this.activeProcesses) {
      try { proc.kill(); } catch { /* already exited */ }
    }
    this.activeProcesses.clear();

    // 2. Kill orphaned soffice processes spawned by our headless profile.
    //    We only kill processes whose command line references our private
    //    headless profile directory, to avoid killing the user's own
    //    LibreOffice GUI session.
    try {
      if (process.platform === "win32") {
        // Use WMIC to find soffice.bin processes that reference our profile dir
        const profileFragment = this.headlessProfileDir.replace(/\\/g, "\\\\");
        await execAsync(
          `wmic process where "name='soffice.bin' and CommandLine like '%${profileFragment}%'" call terminate`,
          { windowsHide: true, timeout: 5000 }
        ).catch(() => {});
      } else {
        // On Unix, pkill matching the profile dir
        const profileFragment = this.headlessProfileDir;
        await execAsync(
          `pkill -f "${profileFragment}" 2>/dev/null || true`,
          { timeout: 5000 }
        ).catch(() => {});
      }
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Read the plain text / structured content back from an existing ODF document.
   * Returns { text, rows, slides } — only the field relevant to the doc type is populated.
   */
  async readDocumentContent(id: number): Promise<{
    success: boolean;
    text?: string;
    rows?: string[][];
    slides?: Array<{ title: string; content: string; notes?: string }>;
    error?: string;
  }> {
    const db = getDb();
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) return { success: false, error: "Document not found" };
    try {
      await fs.access(doc.filePath);
    } catch {
      return { success: false, error: "Document file not found on disk" };
    }

    try {
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(doc.filePath);
      const contentXml: string = zip.readAsText("content.xml");

      if (doc.type === "spreadsheet") {
        // Parse table rows
        const rows: string[][] = [];
        const rowRegex = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g;
        const cellRegex = /<table:table-cell[^>]*>[\s\S]*?<text:p[^>]*>(.*?)<\/text:p>[\s\S]*?<\/table:table-cell>|<table:table-cell[^>]*\/>/g;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(contentXml)) !== null) {
          const cells: string[] = [];
          const rowContent = rowMatch[1];
          let cellMatch;
          while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            const raw = (cellMatch[1] || "").replace(/<[^>]+>/g, "")
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
            cells.push(raw);
          }
          if (cells.length > 0) rows.push(cells);
        }
        return { success: true, rows };
      }

      if (doc.type === "presentation") {
        // Parse draw:page elements as slides
        const slides: Array<{ title: string; content: string; notes?: string }> = [];
        const pageRegex = /<draw:page[^>]*>([\s\S]*?)<\/draw:page>/g;
        const textRegex = /<text:(?:p|h)[^>]*>(.*?)<\/text:(?:p|h)>/g;
        let pageMatch;
        while ((pageMatch = pageRegex.exec(contentXml)) !== null) {
          const pageContent = pageMatch[1];
          const texts: string[] = [];
          let tm;
          while ((tm = textRegex.exec(pageContent)) !== null) {
            const t = (tm[1] || "").replace(/<[^>]+>/g, "")
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
            if (t) texts.push(t);
          }
          slides.push({
            title: texts[0] || "Untitled Slide",
            content: texts.slice(1).join("\n"),
          });
        }
        return { success: true, slides };
      }

      // Text document — extract paragraphs
      const paragraphs: string[] = [];
      const paraRegex = /<text:(?:p|h)[^>]*>(.*?)<\/text:(?:p|h)>/g;
      let pm;
      while ((pm = paraRegex.exec(contentXml)) !== null) {
        const t = (pm[1] || "").replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
        if (t) paragraphs.push(t);
      }
      return { success: true, text: paragraphs.join("\n\n") };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to read document",
      };
    }
  }

  /**
   * Rewrite the content of an existing document from plain text / structured data.
   * Updates the ODF zip on disk and touches the DB updatedAt timestamp.
   */
  async updateDocumentContent(
    id: number,
    payload: {
      text?: string;
      rows?: string[][];
      slides?: Array<{ title: string; content: string; notes?: string }>;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) return { success: false, error: "Document not found" };

    try {
      let content: DocumentContent | SpreadsheetContent | PresentationContent;
      if (doc.type === "spreadsheet" && payload.rows) {
        const colLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const cells: SpreadsheetCell[] = [];
        payload.rows.forEach((row, ri) => {
          row.forEach((val, ci) => {
            if (ci < 26) {
              const num = Number(val);
              cells.push({ row: ri + 1, col: colLetters[ci], value: !isNaN(num) && val !== "" ? num : val });
            }
          });
        });
        content = { sheets: [{ name: "Sheet1", cells }] } as SpreadsheetContent;
      } else if (doc.type === "presentation" && payload.slides) {
        content = {
          slides: payload.slides.map((s, idx) => ({
            layout: idx === 0 ? "title" as const : "content" as const,
            title: s.title,
            content: s.content
              ? s.content.split("\n").filter(Boolean).map((line) => ({ type: "paragraph" as const, content: line }))
              : [],
            notes: s.notes,
          })),
        } as PresentationContent;
      } else if (payload.text !== undefined) {
        // Parse plain text back to DocumentContent sections
        const lines = payload.text.split("\n");
        const sections: DocumentSection[] = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          if (line.startsWith("# ")) {
            sections.push({ type: "heading", level: 1, content: line.slice(2).trim() });
          } else if (line.startsWith("## ")) {
            sections.push({ type: "heading", level: 2, content: line.slice(3).trim() });
          } else if (line.startsWith("### ")) {
            sections.push({ type: "heading", level: 3, content: line.slice(4).trim() });
          } else if (line.startsWith("- ") || line.startsWith("* ")) {
            sections.push({ type: "list", content: line.slice(2).trim() });
          } else {
            sections.push({ type: "paragraph", content: line.trim() });
          }
        }
        content = { title: doc.name, sections } as DocumentContent;
      } else {
        return { success: false, error: "No content provided" };
      }

      let xmlContent: string;
      if (doc.type === "document") xmlContent = this.generateDocumentXML(content as DocumentContent);
      else if (doc.type === "spreadsheet") xmlContent = this.generateSpreadsheetXML(content as SpreadsheetContent);
      else xmlContent = this.generatePresentationXML(content as PresentationContent);

      await this.writeDocumentContent(doc.filePath, doc.type as DocumentType, xmlContent);
      await db.update(documents).set({ updatedAt: new Date().toISOString() } as any).where(eq(documents.id, id));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update document",
      };
    }
  }

  /**
   * Stream an AI-powered editing command on document text.
   * Sends libreoffice:ai-assist-chunk events to the renderer.
   * Commands: improve | grammar | summarize | continue | tone | explain | custom
   */
  async streamAiAssist(
    event: IpcMainInvokeEvent,
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
    }
  ): Promise<void> {
    const settings = readSettings();
    let selectedModel = (settings as any).documentAiModel || settings.selectedModel;
    if (params.provider && params.model) {
      selectedModel = { provider: params.provider, name: params.model };
    }

    const commandPrompts: Record<string, string> = {
      improve: "Rewrite the following text to significantly improve its quality. Enhance clarity, flow, precision, and impact. Strengthen weak verbs, eliminate redundancy, improve sentence variety, and add specificity where the original is vague. Maintain the original meaning and approximate length. Return only the improved text:",
      grammar: "Fix all grammar, spelling, punctuation, and syntax errors in the following text. Also fix awkward phrasing, subject-verb agreement issues, and inconsistent tense usage. Return only the corrected text, no explanations:",
      summarize: "Write a comprehensive yet concise summary of the following text. Capture all key points, main arguments, and critical details in 3-5 well-crafted sentences. The summary should stand alone as a complete understanding of the source material. Return only the summary:",
      continue: "Continue writing the following text naturally and substantively. Match the existing style, tone, vocabulary level, and subject matter precisely. Add 2-4 fully developed paragraphs that advance the topic with new insights, evidence, or analysis — not just repetition of what came before. Each paragraph should be 4-6 sentences:",
      explain: "Explain the following text in clear, accessible language suitable for a general professional audience. Break down key concepts, define technical terms, explain the significance and implications, and provide relevant context. Organize the explanation logically:",
      tone: `Rewrite the following text in a ${params.toneValue || "professional"} tone while preserving all factual content and key points. Adjust vocabulary, sentence structure, and rhetorical approach to match the target tone consistently throughout. Return only the rewritten text:`,
      custom: params.customPrompt || "Improve the following text:",
    };

    const systemPrompt = "You are a senior professional editor and writing expert embedded in a document editor. You produce publication-quality text transformations. Respond only with the requested text — no preamble, no explanation, no markdown code fences, no meta-commentary. Write with precision, authority, and craft.";
    const userPrompt = `${commandPrompts[params.command]}\n\n${params.selection}`;

    try {
      const { modelClient } = await getModelClient(selectedModel, settings);
      const stream = streamText({ model: modelClient.model, system: systemPrompt, prompt: userPrompt });

      for await (const chunk of stream.textStream) {
        safeSend(event.sender, "libreoffice:ai-assist-chunk", {
          requestId,
          text: chunk,
          done: false,
        });
      }

      // Record cost with the smart cost engine
      try {
        const usage = await stream.usage;
        if (usage) {
          recordAICost({
            model: selectedModel?.name ?? "unknown",
            provider: modelClient.builtinProviderId ?? selectedModel?.provider ?? "unknown",
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            taskType: "document-assist",
            source: "agent",
          });
        }
      } catch { /* best-effort */ }

      safeSend(event.sender, "libreoffice:ai-assist-chunk", {
        requestId,
        text: "",
        done: true,
      });
    } catch (error) {
      safeSend(event.sender, "libreoffice:ai-assist-chunk", {
        requestId,
        text: "",
        done: true,
        error: error instanceof Error ? error.message : "AI assist failed",
      });
    }
  }

  /**
   * Stream AI document generation — sends text chunks to the renderer in
   * real-time, then creates and saves the document once streaming finishes.
   */
  async streamGenerateDocument(
    event: IpcMainInvokeEvent,
    requestId: string,
    type: DocumentType,
    name: string,
    options: AIGenerationOptions
  ): Promise<void> {
    const settings = readSettings();
    // Prefer documentAiModel from settings, then global selectedModel
    let selectedModel = (settings as Record<string, unknown>).documentAiModel as { provider: string; name: string } | undefined
      ?? settings.selectedModel;

    if (options.routingMode === "smart") {
      try {
        const decision = await smartRouter.route({
          taskType: type === "spreadsheet" ? "extraction" : "creative_writing",
          prompt: options.prompt,
          privacyLevel: "standard",
        });
        selectedModel = { provider: decision.providerId, name: decision.modelId };
      } catch {
        // fall back to default
      }
    } else if (options.provider && options.model) {
      selectedModel = { provider: options.provider, name: options.model };
    }

    const systemPrompt = this.getDocumentGenerationSystemPrompt(type, options);
    const userPrompt = this.buildUserPrompt(type, name, options);
    const maxTokens = this.getMaxTokensForLength(options.length);

    try {
      console.log("[StreamDocGen] Selected model:", JSON.stringify(selectedModel));
      console.log("[StreamDocGen] maxOutputTokens:", maxTokens);
      console.log("[StreamDocGen] options:", JSON.stringify(options));
      
      const { modelClient } = await getModelClient(selectedModel, settings);
      console.log("[StreamDocGen] Model client obtained, model type:", typeof modelClient.model, modelClient.builtinProviderId);

      let fullText = "";
      const stream = streamText({
        model: modelClient.model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: maxTokens,
      });

      let chunkCount = 0;
      for await (const chunk of stream.textStream) {
        fullText += chunk;
        chunkCount++;
        if (chunkCount <= 3) {
          console.log(`[StreamDocGen] chunk #${chunkCount} (${chunk.length} chars):`, chunk.substring(0, 100));
        }
        safeSend(event.sender, "libreoffice:generate-chunk", {
          requestId,
          text: chunk,
          done: false,
        });
      }
      console.log("[StreamDocGen] Stream complete. Total chunks:", chunkCount, "Total text length:", fullText.length);
      console.log("[StreamDocGen] fullText preview:", fullText.substring(0, 300));

      // Record cost with the smart cost engine
      try {
        const usage = await stream.usage;
        if (usage) {
          recordAICost({
            model: selectedModel?.name ?? "unknown",
            provider: modelClient.builtinProviderId ?? selectedModel?.provider ?? "unknown",
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            taskType: "document-generate",
            source: "agent",
          });
        }
      } catch { /* best-effort */ }

      // Parse the streamed response and create the document
      const content = this.parseAIResponseToContent(type, fullText, options);
      const db = getDb();
      const format = FORMAT_EXTENSIONS[type];
      const fileName = `${name.replace(/[^a-zA-Z0-9-_]/g, "_")}_${Date.now()}.${format}`;
      const filePath = path.join(this.documentsDir, fileName);

      let xmlContent: string;
      if (type === "document") {
        xmlContent = this.generateDocumentXML(content as DocumentContent);
      } else if (type === "spreadsheet") {
        xmlContent = this.generateSpreadsheetXML(content as SpreadsheetContent);
      } else {
        xmlContent = this.generatePresentationXML(content as PresentationContent);
      }

      await this.writeDocumentContent(filePath, type, xmlContent);

      const [doc] = await db
        .insert(documents)
        .values({
          name,
          type,
          format,
          status: "ready",
          filePath,
          description: options.prompt || null,
          aiPrompt: options.prompt,
          aiModel: `${selectedModel.provider}/${selectedModel.name}`,
        })
        .returning();

      safeSend(event.sender, "libreoffice:generate-chunk", {
        requestId,
        text: "",
        done: true,
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
        } satisfies BaseDocument,
      });
    } catch (error) {
      safeSend(event.sender, "libreoffice:generate-chunk", {
        requestId,
        text: "",
        done: true,
        error: error instanceof Error ? error.message : "AI generation failed",
      });
    }
  }

  /**
   * Check if any consumer is currently active.
   */
  isActive(): boolean {
    return this.refCount > 0 || this.activeProcesses.size > 0;
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

  // Update document metadata (name, description, tags)
  ipcMain.handle("libreoffice:update-metadata", async (_, params: { id: number; name?: string; description?: string; tags?: string[] }) => {
    const db = getDb();
    const existing = db.select().from(documents).where(eq(documents.id, params.id)).get();
    if (!existing) throw new Error(`Document not found: ${params.id}`);

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (params.name !== undefined) updates.name = params.name;
    if (params.description !== undefined) updates.description = params.description;
    if (params.tags !== undefined) updates.tags = params.tags;

    db.update(documents).set(updates).where(eq(documents.id, params.id)).run();
    return db.select().from(documents).where(eq(documents.id, params.id)).get();
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

  // Lifecycle: signal that a consumer (e.g. Document Studio) is active.
  // Returns current LibreOffice status. Call on page mount.
  ipcMain.handle("libreoffice:ensure-ready", async () => {
    return manager.ensureReady();
  });

  // Lifecycle: signal that a consumer has unmounted.
  // When no consumers remain, kills any orphaned soffice processes.
  ipcMain.handle("libreoffice:shutdown", async () => {
    await manager.shutdown();
  });

  // AI streaming document generation — sends libreoffice:generate-chunk events
  // to the renderer with live text chunks and completes with the saved document.
  ipcMain.handle(
    "libreoffice:stream-generate",
    async (
      event,
      params: {
        requestId: string;
        type: DocumentType;
        name: string;
        options: AIGenerationOptions;
      }
    ) => {
      // Start the stream in a non-blocking async flow so the invoke returns
      // immediately (chunk events carry progress; done event carries result).
      manager
        .streamGenerateDocument(event, params.requestId, params.type, params.name, params.options)
        .catch((err) => {
          safeSend(event.sender, "libreoffice:generate-chunk", {
            requestId: params.requestId,
            text: "",
            done: true,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return { started: true };
    }
  );

  // Read the plain-text / structured content of an existing document.
  ipcMain.handle("libreoffice:read-content", async (_event, id: number) => {
    return manager.readDocumentContent(id);
  });

  // Overwrite a document with edited content.
  ipcMain.handle(
    "libreoffice:update-content",
    async (
      _event,
      id: number,
      payload: {
        text?: string;
        rows?: string[][];
        slides?: Array<{ title: string; content: string; notes?: string }>;
      }
    ) => {
      return manager.updateDocumentContent(id, payload);
    }
  );

  // Stream an AI editing command on selected document text.
  ipcMain.handle(
    "libreoffice:ai-assist",
    async (
      event,
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
      }
    ) => {
      manager
        .streamAiAssist(event, requestId, params)
        .catch((err) => {
          safeSend(event.sender, "libreoffice:ai-assist-chunk", {
            requestId,
            text: "",
            done: true,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return { started: true };
    }
  );
}

export { LibreOfficeManager };
