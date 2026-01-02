/**
 * LibreOffice Integration Types
 * Types for document creation, editing, and export
 */

// Document Types
export type DocumentType = "document" | "spreadsheet" | "presentation";
export type DocumentFormat = 
  | "odt" | "docx" | "doc" | "rtf" | "txt" | "html" | "pdf"  // Documents
  | "ods" | "xlsx" | "xls" | "csv"                           // Spreadsheets
  | "odp" | "pptx" | "ppt";                                  // Presentations

export type ExportFormat = "pdf" | "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp" | "html" | "txt" | "csv";

// Document Status
export type DocumentStatus = "draft" | "generating" | "ready" | "error";

// Base Document Interface
export interface BaseDocument {
  id: number;
  name: string;
  type: DocumentType;
  format: DocumentFormat;
  status: DocumentStatus;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  size?: number;
  thumbnail?: string;
  tags?: string[];
  description?: string;
}

// Document Creation Request
export interface CreateDocumentRequest {
  name: string;
  type: DocumentType;
  format?: DocumentFormat;
  content?: DocumentContent;
  templateId?: string;
  aiGenerate?: AIGenerationOptions;
}

// AI Generation Options
export interface AIGenerationOptions {
  prompt: string;
  provider?: string;  // 'local' | 'openai' | 'anthropic' | etc.
  model?: string;
  style?: DocumentStyle;
  sections?: string[];
  language?: string;
  tone?: "formal" | "casual" | "professional" | "creative";
  length?: "short" | "medium" | "long" | "detailed";
}

// Document Style
export interface DocumentStyle {
  theme?: string;
  fontFamily?: string;
  fontSize?: number;
  headerStyle?: string;
  colorScheme?: string;
}

// Document Content Types
export interface DocumentContent {
  title?: string;
  subtitle?: string;
  author?: string;
  sections?: DocumentSection[];
  metadata?: Record<string, string>;
}

export interface DocumentSection {
  id?: string;
  type: "heading" | "paragraph" | "list" | "table" | "image" | "chart" | "code" | "quote";
  level?: number;  // For headings (1-6)
  content: string | TableContent | ListContent | ChartContent;
  style?: SectionStyle;
}

export interface SectionStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  alignment?: "left" | "center" | "right" | "justify";
}

// Table Content
export interface TableContent {
  headers: string[];
  rows: string[][];
  style?: TableStyle;
}

export interface TableStyle {
  headerBackground?: string;
  alternateRowColors?: boolean;
  borderColor?: string;
  borderWidth?: number;
}

// List Content
export interface ListContent {
  items: string[];
  ordered?: boolean;
  bulletStyle?: string;
}

// Chart Content (for presentations/spreadsheets)
export interface ChartContent {
  type: "bar" | "line" | "pie" | "scatter" | "area";
  title?: string;
  data: ChartData;
  options?: ChartOptions;
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string;
}

export interface ChartOptions {
  legend?: boolean;
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

// Spreadsheet-specific types
export interface SpreadsheetContent {
  sheets: SpreadsheetSheet[];
}

export interface SpreadsheetSheet {
  name: string;
  cells: SpreadsheetCell[];
  columnWidths?: Record<string, number>;
  rowHeights?: Record<number, number>;
}

export interface SpreadsheetCell {
  row: number;
  col: string;  // e.g., "A", "B", "AA"
  value: string | number;
  formula?: string;
  format?: CellFormat;
}

export interface CellFormat {
  type?: "text" | "number" | "currency" | "percentage" | "date";
  decimals?: number;
  currency?: string;
  dateFormat?: string;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: string;
  textColor?: string;
  alignment?: "left" | "center" | "right";
}

// Presentation-specific types
export interface PresentationContent {
  slides: PresentationSlide[];
  theme?: PresentationTheme;
}

export interface PresentationSlide {
  layout: "title" | "content" | "two-column" | "image" | "blank" | "section";
  title?: string;
  subtitle?: string;
  content?: DocumentSection[];
  notes?: string;
  background?: SlideBackground;
}

export interface SlideBackground {
  type: "color" | "gradient" | "image";
  value: string;
  opacity?: number;
}

export interface PresentationTheme {
  name: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  backgroundStyle?: string;
}

// Export Options
export interface ExportDocumentRequest {
  documentId: number;
  format: ExportFormat;
  outputPath?: string;
  options?: ExportOptions;
}

export interface ExportOptions {
  quality?: "draft" | "normal" | "high";
  embedFonts?: boolean;
  pdfA?: boolean;  // PDF/A compliance
  password?: string;
  watermark?: string;
}

// Document Templates
export interface DocumentTemplate {
  id: string;
  name: string;
  type: DocumentType;
  description: string;
  thumbnail?: string;
  category: string;
  content: DocumentContent | SpreadsheetContent | PresentationContent;
}

// LibreOffice Status
export interface LibreOfficeStatus {
  installed: boolean;
  version?: string;
  path?: string;
  headlessSupport: boolean;
}

// Operation Results
export interface DocumentOperationResult {
  success: boolean;
  document?: BaseDocument;
  error?: string;
  filePath?: string;
}

export interface GenerationProgress {
  stage: "analyzing" | "generating" | "formatting" | "saving" | "complete";
  progress: number;  // 0-100
  message: string;
}

// Document List Query
export interface DocumentListQuery {
  type?: DocumentType;
  status?: DocumentStatus;
  search?: string;
  tags?: string[];
  sortBy?: "name" | "createdAt" | "updatedAt" | "size";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}
