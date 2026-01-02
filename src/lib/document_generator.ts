/**
 * AI Document Generator
 * Uses AI models (local or API) to generate document content
 */

import type {
  DocumentType,
  DocumentContent,
  SpreadsheetContent,
  PresentationContent,
  AIGenerationOptions,
  DocumentSection,
} from "@/types/libreoffice_types";

interface GenerationResult {
  success: boolean;
  content?: DocumentContent | SpreadsheetContent | PresentationContent;
  error?: string;
}

/**
 * Generate document content using AI
 */
export async function generateDocumentContent(
  type: DocumentType,
  options: AIGenerationOptions
): Promise<GenerationResult> {
  try {
    const systemPrompt = getSystemPrompt(type, options);
    const userPrompt = buildUserPrompt(type, options);

    // For now, generate structured content locally
    // In production, this would call the AI model via IPC
    const content = await generateStructuredContent(type, options);

    return {
      success: true,
      content,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate content",
    };
  }
}

function getSystemPrompt(type: DocumentType, options: AIGenerationOptions): string {
  const toneInstructions = {
    formal: "Use formal language, proper titles, and structured formatting.",
    casual: "Use conversational language while maintaining clarity.",
    professional: "Use professional business language with clear, concise points.",
    creative: "Use engaging, creative language with vivid descriptions.",
  };

  const tone = toneInstructions[options.tone || "professional"];

  const typeInstructions: Record<DocumentType, string> = {
    document: `You are creating a written document. ${tone} Structure the content with clear headings, paragraphs, and lists where appropriate.`,
    spreadsheet: `You are creating data for a spreadsheet. Organize data in rows and columns with clear headers. Include formulas where calculations are needed.`,
    presentation: `You are creating a presentation. ${tone} Create slides with concise bullet points, one main idea per slide, and engaging titles.`,
  };

  return typeInstructions[type];
}

function buildUserPrompt(type: DocumentType, options: AIGenerationOptions): string {
  const lengthGuide = {
    short: "Keep it brief (1-2 pages or 5-7 slides)",
    medium: "Medium length (3-5 pages or 8-12 slides)",
    long: "Comprehensive (6-10 pages or 15-20 slides)",
    detailed: "Very detailed (10+ pages or 25+ slides)",
  };

  const length = lengthGuide[options.length || "medium"];

  let prompt = options.prompt;
  
  if (options.sections?.length) {
    prompt += `\n\nInclude the following sections: ${options.sections.join(", ")}`;
  }

  if (options.language && options.language !== "en") {
    prompt += `\n\nWrite the content in ${options.language}.`;
  }

  prompt += `\n\n${length}`;

  return prompt;
}

async function generateStructuredContent(
  type: DocumentType,
  options: AIGenerationOptions
): Promise<DocumentContent | SpreadsheetContent | PresentationContent> {
  // This is a placeholder that generates example content
  // In production, this would parse AI model responses

  if (type === "document") {
    return generateDocumentStructure(options);
  } else if (type === "spreadsheet") {
    return generateSpreadsheetStructure(options);
  } else {
    return generatePresentationStructure(options);
  }
}

function generateDocumentStructure(options: AIGenerationOptions): DocumentContent {
  const sections: DocumentSection[] = [];
  
  // Title
  sections.push({
    type: "heading",
    level: 1,
    content: extractTitle(options.prompt),
  });

  // Introduction
  sections.push({
    type: "paragraph",
    content: `This document was generated based on: "${options.prompt}"`,
  });

  // Main sections based on common document structures
  const defaultSections = options.sections || [
    "Executive Summary",
    "Background",
    "Key Findings",
    "Recommendations",
    "Conclusion",
  ];

  for (const sectionTitle of defaultSections) {
    sections.push({
      type: "heading",
      level: 2,
      content: sectionTitle,
    });
    sections.push({
      type: "paragraph",
      content: `[Content for ${sectionTitle} will be generated here based on your requirements]`,
    });
  }

  return {
    title: extractTitle(options.prompt),
    author: "JoyCreate AI",
    sections,
    metadata: {
      generatedBy: "JoyCreate Document Studio",
      prompt: options.prompt,
      tone: options.tone || "professional",
    },
  };
}

function generateSpreadsheetStructure(options: AIGenerationOptions): SpreadsheetContent {
  // Generate example spreadsheet based on prompt keywords
  const isFinancial = /budget|finance|revenue|cost|expense|sales/i.test(options.prompt);
  const isData = /data|analysis|statistics|metrics/i.test(options.prompt);
  const isSchedule = /schedule|timeline|calendar|plan/i.test(options.prompt);

  if (isFinancial) {
    return {
      sheets: [{
        name: "Financial Data",
        cells: [
          { row: 1, col: "A", value: "Category" },
          { row: 1, col: "B", value: "Q1" },
          { row: 1, col: "C", value: "Q2" },
          { row: 1, col: "D", value: "Q3" },
          { row: 1, col: "E", value: "Q4" },
          { row: 1, col: "F", value: "Total" },
          { row: 2, col: "A", value: "Revenue" },
          { row: 2, col: "B", value: 100000 },
          { row: 2, col: "C", value: 120000 },
          { row: 2, col: "D", value: 115000 },
          { row: 2, col: "E", value: 140000 },
          { row: 3, col: "A", value: "Expenses" },
          { row: 3, col: "B", value: 75000 },
          { row: 3, col: "C", value: 80000 },
          { row: 3, col: "D", value: 78000 },
          { row: 3, col: "E", value: 85000 },
          { row: 4, col: "A", value: "Profit" },
          { row: 4, col: "B", value: 25000 },
          { row: 4, col: "C", value: 40000 },
          { row: 4, col: "D", value: 37000 },
          { row: 4, col: "E", value: 55000 },
        ],
      }],
    };
  }

  // Default data structure
  return {
    sheets: [{
      name: "Data",
      cells: [
        { row: 1, col: "A", value: "Item" },
        { row: 1, col: "B", value: "Value" },
        { row: 1, col: "C", value: "Notes" },
        { row: 2, col: "A", value: "Item 1" },
        { row: 2, col: "B", value: 100 },
        { row: 2, col: "C", value: "First item" },
        { row: 3, col: "A", value: "Item 2" },
        { row: 3, col: "B", value: 200 },
        { row: 3, col: "C", value: "Second item" },
        { row: 4, col: "A", value: "Item 3" },
        { row: 4, col: "B", value: 300 },
        { row: 4, col: "C", value: "Third item" },
      ],
    }],
  };
}

function generatePresentationStructure(options: AIGenerationOptions): PresentationContent {
  const title = extractTitle(options.prompt);
  
  return {
    slides: [
      {
        layout: "title",
        title: title,
        subtitle: `Generated by JoyCreate AI`,
      },
      {
        layout: "content",
        title: "Agenda",
        content: [
          { type: "list", content: { items: ["Introduction", "Key Points", "Details", "Summary", "Q&A"], ordered: true } },
        ],
      },
      {
        layout: "content",
        title: "Introduction",
        content: [
          { type: "paragraph", content: `Overview of ${title}` },
          { type: "list", content: { items: ["Background context", "Purpose and goals", "Scope of presentation"] } },
        ],
      },
      {
        layout: "content",
        title: "Key Points",
        content: [
          { type: "list", content: { items: ["Main point 1: Core concept", "Main point 2: Supporting evidence", "Main point 3: Implications"] } },
        ],
      },
      {
        layout: "content",
        title: "Summary",
        content: [
          { type: "paragraph", content: "Key takeaways from this presentation" },
          { type: "list", content: { items: ["Conclusion 1", "Conclusion 2", "Next steps"] } },
        ],
      },
      {
        layout: "content",
        title: "Questions?",
        subtitle: "Thank you for your attention",
        content: [],
      },
    ],
    theme: {
      name: "Professional",
      primaryColor: "#2563eb",
      secondaryColor: "#64748b",
    },
  };
}

function extractTitle(prompt: string): string {
  // Extract a suitable title from the prompt
  const words = prompt.split(" ").slice(0, 6);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export { generateStructuredContent, generateDocumentStructure, generateSpreadsheetStructure, generatePresentationStructure };
