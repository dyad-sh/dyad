/**
 * Agent Tool Catalog
 * Pre-built tool definitions for the Agent Builder
 * Includes: Knowledge Search, Document editing, Google Docs, Summarize, LLM,
 * Perplexity, Google Search/Scrape/Summarize, PDF/File conversion,
 * Document extraction/parsing, Legal analysis, and more.
 */

// ============================================================================
// Tool Catalog Entry
// ============================================================================

export interface CatalogTool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: string;
  /** n8n node type or custom handler */
  n8nNodeType?: string;
  /** Whether this tool requires credentials */
  requiresCredentials: boolean;
  /** Credential type needed */
  credentialType?: string;
  /** Input schema for the tool */
  inputSchema: CatalogToolInputSchema;
  /** Default parameters */
  defaultParams?: Record<string, unknown>;
  /** Tags for filtering */
  tags: string[];
  /** Whether the tool needs approval per execution */
  requiresApproval: boolean;
}

export interface CatalogToolInputSchema {
  type: "object";
  properties: Record<string, CatalogToolProperty>;
  required?: string[];
}

export interface CatalogToolProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: CatalogToolProperty;
  default?: unknown;
}

export type ToolCategory =
  | "knowledge"
  | "document"
  | "search"
  | "ai"
  | "communication"
  | "data"
  | "file-conversion"
  | "analysis"
  | "integration"
  | "custom";

// ============================================================================
// Pre-built Tool Catalog
// ============================================================================

export const AGENT_TOOL_CATALOG: CatalogTool[] = [
  // ---------------------------------------------------------------------------
  // Knowledge & RAG Tools
  // ---------------------------------------------------------------------------
  {
    id: "advanced-knowledge-search",
    name: "Advanced Knowledge Search",
    description: "Search through knowledge base documents using semantic vector search with relevance scoring",
    category: "knowledge",
    icon: "ðŸ”",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        maxResults: { type: "number", description: "Maximum number of results to return", default: 10 },
        minScore: { type: "number", description: "Minimum relevance score (0-1)", default: 0.7 },
        filters: { type: "object", description: "Metadata filters to apply" },
      },
      required: ["query"],
    },
    tags: ["knowledge", "search", "rag", "vector"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Document Tools
  // ---------------------------------------------------------------------------
  {
    id: "edit-document",
    name: "Edit Document",
    description: "Edit and modify document content with find-replace, append, insert, and structured transformations",
    category: "document",
    icon: "âœï¸",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Document identifier" },
        operation: {
          type: "string",
          description: "Edit operation type",
          enum: ["replace", "append", "insert", "delete", "restructure"],
        },
        content: { type: "string", description: "New content to apply" },
        position: { type: "number", description: "Position for insert operations" },
        find: { type: "string", description: "Text to find for replace operations" },
      },
      required: ["documentId", "operation"],
    },
    tags: ["document", "edit", "content"],
    requiresApproval: false,
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Read, create, and edit Google Docs documents via the Google Docs API",
    category: "document",
    icon: "ðŸ“„",
    n8nNodeType: "n8n-nodes-base.googleDocs",
    requiresCredentials: true,
    credentialType: "googleDocsOAuth2Api",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "Google Docs operation",
          enum: ["create", "get", "update", "append"],
        },
        documentId: { type: "string", description: "Google Doc ID (for existing docs)" },
        title: { type: "string", description: "Document title (for new docs)" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["operation"],
    },
    tags: ["google", "docs", "document", "cloud"],
    requiresApproval: false,
  },
  {
    id: "document-extraction",
    name: "Document Extraction & Parsing",
    description: "Extract structured data, tables, and text from documents (PDF, DOCX, images with OCR)",
    category: "document",
    icon: "ðŸ“‹",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "File path or URL of document" },
        extractionType: {
          type: "string",
          description: "Type of extraction",
          enum: ["text", "tables", "metadata", "images", "structured", "all"],
        },
        ocrEnabled: { type: "boolean", description: "Enable OCR for scanned documents", default: true },
        outputFormat: {
          type: "string",
          description: "Output format",
          enum: ["text", "json", "markdown", "csv"],
          default: "json",
        },
      },
      required: ["source"],
    },
    tags: ["document", "extraction", "parsing", "ocr"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // AI / LLM Tools
  // ---------------------------------------------------------------------------
  {
    id: "llm",
    name: "LLM (Language Model)",
    description: "Send prompts to a large language model for text generation, analysis, and reasoning",
    category: "ai",
    icon: "ðŸ¤–",
    n8nNodeType: "@n8n/n8n-nodes-langchain.chainLlm",
    requiresCredentials: true,
    credentialType: "openAiApi",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt text to send to the LLM" },
        model: {
          type: "string",
          description: "Model to use",
          enum: ["gpt-5.1", "gpt-5-mini", "claude-opus-4-6", "claude-sonnet-4-5", "gemini-3-flash-preview", "llama3.2"],
          default: "gpt-5-mini",
        },
        temperature: { type: "number", description: "Sampling temperature (0-2)", default: 0.7 },
        maxTokens: { type: "number", description: "Maximum tokens to generate", default: 2048 },
        systemPrompt: { type: "string", description: "System prompt for the model" },
      },
      required: ["prompt"],
    },
    tags: ["ai", "llm", "gpt", "claude", "generation"],
    requiresApproval: false,
  },
  {
    id: "summarize",
    name: "Summarize",
    description: "Summarize long text, documents, or conversations into concise summaries with key points",
    category: "ai",
    icon: "ðŸ“",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to summarize" },
        style: {
          type: "string",
          description: "Summary style",
          enum: ["brief", "detailed", "bullet-points", "executive", "technical"],
          default: "brief",
        },
        maxLength: { type: "number", description: "Maximum summary length in words", default: 200 },
        language: { type: "string", description: "Output language", default: "en" },
      },
      required: ["text"],
    },
    tags: ["ai", "summarize", "text", "nlp"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Search Tools
  // ---------------------------------------------------------------------------
  {
    id: "perplexity-search",
    name: "Perplexity Search",
    description: "AI-powered web search using Perplexity API with citations and source verification",
    category: "search",
    icon: "ðŸ”Ž",
    requiresCredentials: true,
    credentialType: "perplexityApi",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        model: {
          type: "string",
          description: "Perplexity model",
          enum: ["sonar-small", "sonar-medium", "sonar-large"],
          default: "sonar-medium",
        },
        includeSources: { type: "boolean", description: "Include source URLs", default: true },
      },
      required: ["query"],
    },
    tags: ["search", "ai", "perplexity", "web"],
    requiresApproval: false,
  },
  {
    id: "google-search",
    name: "Google Search",
    description: "Search the web using Google Custom Search API and return structured results",
    category: "search",
    icon: "ðŸŒ",
    requiresCredentials: true,
    credentialType: "googleSearchApi",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Number of results", default: 10 },
        language: { type: "string", description: "Language code", default: "en" },
        country: { type: "string", description: "Country code for localized results" },
      },
      required: ["query"],
    },
    tags: ["search", "google", "web"],
    requiresApproval: false,
  },
  {
    id: "google-scrape",
    name: "Google Scrape & Summarize",
    description: "Scrape web pages from Google search results and summarize their content",
    category: "search",
    icon: "ðŸ•·ï¸",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to scrape" },
        selector: { type: "string", description: "CSS selector for content extraction" },
        summarize: { type: "boolean", description: "Auto-summarize scraped content", default: true },
        maxDepth: { type: "number", description: "Max crawl depth from initial URL", default: 1 },
      },
      required: ["url"],
    },
    tags: ["search", "scrape", "web", "summarize"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // File Conversion Tools
  // ---------------------------------------------------------------------------
  {
    id: "pdf-conversion",
    name: "PDF Conversion",
    description: "Convert documents between PDF and other formats (DOCX, HTML, Markdown, images)",
    category: "file-conversion",
    icon: "ðŸ“‘",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Source file path or URL" },
        outputFormat: {
          type: "string",
          description: "Target format",
          enum: ["pdf", "docx", "html", "markdown", "text", "png"],
        },
        options: {
          type: "object",
          description: "Conversion options (quality, page range, etc.)",
        },
      },
      required: ["source", "outputFormat"],
    },
    tags: ["file", "conversion", "pdf", "document"],
    requiresApproval: false,
  },
  {
    id: "markdown-conversion",
    name: "Markdown Conversion",
    description: "Convert content to/from Markdown format with support for HTML, DOCX, and plain text",
    category: "file-conversion",
    icon: "ðŸ“ƒ",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to convert" },
        fromFormat: {
          type: "string",
          description: "Source format",
          enum: ["html", "docx", "text", "rst", "latex"],
        },
        toFormat: {
          type: "string",
          description: "Target format",
          enum: ["markdown", "html", "docx", "text", "pdf"],
          default: "markdown",
        },
      },
      required: ["content", "fromFormat"],
    },
    tags: ["file", "conversion", "markdown"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Analysis Tools
  // ---------------------------------------------------------------------------
  {
    id: "legal-document-analysis",
    name: "Legal Document Analysis",
    description: "Analyze legal documents, contracts, and agreements to extract clauses, risks, and obligations",
    category: "analysis",
    icon: "âš–ï¸",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "string", description: "Document content or file path" },
        analysisType: {
          type: "string",
          description: "Type of analysis",
          enum: ["full", "risk-assessment", "clause-extraction", "compliance-check", "summary"],
          default: "full",
        },
        jurisdiction: { type: "string", description: "Legal jurisdiction" },
        focusAreas: {
          type: "array",
          description: "Specific areas to focus on",
          items: { type: "string", description: "Focus area" },
        },
      },
      required: ["document"],
    },
    tags: ["legal", "analysis", "contract", "compliance"],
    requiresApproval: true,
  },
  {
    id: "data-analysis",
    name: "Data Analysis",
    description: "Analyze structured data sets with statistical operations, trends, and insights",
    category: "analysis",
    icon: "ðŸ“Š",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data source (CSV, JSON, or inline)" },
        operation: {
          type: "string",
          description: "Analysis operation",
          enum: ["summary", "trends", "correlations", "outliers", "forecast", "custom"],
        },
        query: { type: "string", description: "Natural language analysis query" },
        outputFormat: {
          type: "string",
          description: "Output format",
          enum: ["text", "json", "chart", "table"],
          default: "text",
        },
      },
      required: ["data"],
    },
    tags: ["data", "analysis", "statistics"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Communication Tools
  // ---------------------------------------------------------------------------
  {
    id: "send-email",
    name: "Send Email",
    description: "Send emails via SMTP or Gmail API with support for attachments and HTML content",
    category: "communication",
    icon: "ðŸ“§",
    n8nNodeType: "n8n-nodes-base.emailSend",
    requiresCredentials: true,
    credentialType: "smtp",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body (text or HTML)" },
        isHtml: { type: "boolean", description: "Whether body is HTML", default: false },
        attachments: {
          type: "array",
          description: "File paths to attach",
          items: { type: "string", description: "File path" },
        },
      },
      required: ["to", "subject", "body"],
    },
    tags: ["email", "communication", "notification"],
    requiresApproval: true,
  },
  {
    id: "slack-message",
    name: "Slack Message",
    description: "Send messages and rich blocks to Slack channels or users",
    category: "communication",
    icon: "ðŸ’¬",
    n8nNodeType: "n8n-nodes-base.slack",
    requiresCredentials: true,
    credentialType: "slackApi",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Slack channel name or ID" },
        message: { type: "string", description: "Message text" },
        blocks: { type: "object", description: "Slack Block Kit blocks" },
        threadTs: { type: "string", description: "Thread timestamp (for replies)" },
      },
      required: ["channel", "message"],
    },
    tags: ["slack", "messaging", "communication"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Integration Tools
  // ---------------------------------------------------------------------------
  {
    id: "http-request",
    name: "HTTP Request",
    description: "Make HTTP/REST API requests with customizable method, headers, body, and authentication",
    category: "integration",
    icon: "ðŸŒ",
    n8nNodeType: "n8n-nodes-base.httpRequest",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Request URL" },
        method: {
          type: "string",
          description: "HTTP method",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          default: "GET",
        },
        headers: { type: "object", description: "Request headers" },
        body: { type: "string", description: "Request body" },
        auth: {
          type: "string",
          description: "Authentication type",
          enum: ["none", "basic", "bearer", "apiKey"],
          default: "none",
        },
      },
      required: ["url"],
    },
    tags: ["http", "api", "rest", "integration"],
    requiresApproval: false,
  },
  {
    id: "code-execution",
    name: "Code Execution",
    description: "Execute JavaScript or Python code snippets within the agent workflow",
    category: "integration",
    icon: "ðŸ’»",
    n8nNodeType: "n8n-nodes-base.code",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Code to execute" },
        language: {
          type: "string",
          description: "Programming language",
          enum: ["javascript", "python"],
          default: "javascript",
        },
        inputs: { type: "object", description: "Input variables for the code" },
      },
      required: ["code"],
    },
    tags: ["code", "execution", "javascript", "python"],
    requiresApproval: true,
  },

  // ---------------------------------------------------------------------------
  // Knowledge â€” Cache Augmented Generation (CAG)
  // ---------------------------------------------------------------------------
  {
    id: "cag-knowledge",
    name: "Cache Augmented Generation (CAG)",
    description:
      "Load all documents and text into a long LLM context window (up to 2M tokens) to retrieve and generate responses directly via Cache Augmented Generation",
    category: "knowledge",
    icon: "ðŸ§ ",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Question or prompt to answer from knowledge" },
        sourceIds: {
          type: "array",
          description: "Knowledge source IDs to include",
          items: { type: "string", description: "Source ID" },
        },
        contextWindow: {
          type: "string",
          description: "Context window size",
          enum: ["standard", "large", "2m"],
          default: "large",
        },
        preferLocal: { type: "boolean", description: "Prefer local LLM", default: false },
      },
      required: ["query"],
    },
    tags: ["knowledge", "cag", "rag", "context-window", "2m"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Document â€” Form Filling
  // ---------------------------------------------------------------------------
  {
    id: "form-fill",
    name: "Fill Forms & Tables",
    description:
      "Fill in forms, tables, and checkboxes in documents automatically using AI-powered extraction and structured data mapping",
    category: "document",
    icon: "ðŸ“",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        documentPath: { type: "string", description: "Path to the document to fill" },
        formData: { type: "object", description: "Key-value pairs of form field names and their values" },
        autoDetect: {
          type: "boolean",
          description: "Auto-detect form fields using AI",
          default: true,
        },
        outputPath: { type: "string", description: "Path to save filled document" },
      },
      required: ["documentPath"],
    },
    tags: ["document", "forms", "tables", "fill", "checkboxes"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Document â€” Parse / OCR
  // ---------------------------------------------------------------------------
  {
    id: "document-parse",
    name: "Parse Document",
    description:
      "Parse documents (PDFs, images, spreadsheets) into structured text, tables, and figures with high accuracy using AI-powered extraction and OCR",
    category: "document",
    icon: "ðŸ“‹",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        documentPath: { type: "string", description: "Path to the document to parse" },
        outputFormat: {
          type: "string",
          description: "Output format for parsed content",
          enum: ["text", "markdown", "json", "html"],
          default: "markdown",
        },
        extractTables: { type: "boolean", description: "Extract tables into structured data", default: true },
        extractFigures: { type: "boolean", description: "Extract figures and diagrams", default: true },
        ocrEnabled: { type: "boolean", description: "Enable OCR for scanned documents", default: true },
      },
      required: ["documentPath"],
    },
    tags: ["document", "parse", "ocr", "pdf", "tables", "figures"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Search/Scraping â€” Web Scraper Tool (integrates scraping engine)
  // ---------------------------------------------------------------------------
  {
    id: "web-scraper-tool",
    name: "Web Scraper",
    description:
      "Scrape web pages, crawl sites, extract structured data with AI, and store results as knowledge. " +
      "Supports templates for news, e-commerce, jobs, recipes, academic papers, and more. Respects robots.txt.",
    category: "search",
    icon: "ðŸ•·ï¸",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to scrape" },
        description: { type: "string", description: "What to extract (natural language)" },
        templateId: {
          type: "string",
          description: "Template: news-articles, ecommerce-products, job-listings, recipes, research-papers, etc.",
        },
        crawl: { type: "boolean", description: "Crawl linked pages", default: false },
        maxPages: { type: "number", description: "Max pages to crawl", default: 10 },
        aiExtraction: { type: "boolean", description: "Use AI to extract structured data", default: true },
      },
      required: ["url"],
    },
    tags: ["scraping", "web", "crawl", "extract", "data"],
    requiresApproval: false,
  },

  // ---------------------------------------------------------------------------
  // Data â€” Database Query
  // ---------------------------------------------------------------------------
  {
    id: "database-query",
    name: "Database Query",
    description: "Execute SQL queries against local SQLite database or connect to external databases for data retrieval",
    category: "data",
    icon: "ðŸ—„ï¸",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "SQL query to execute" },
        database: {
          type: "string",
          description: "Database connection",
          enum: ["local", "external"],
          default: "local",
        },
        connectionString: { type: "string", description: "External database connection string (if external)" },
        readOnly: { type: "boolean", description: "Read-only mode (prevents writes)", default: true },
      },
      required: ["query"],
    },
    tags: ["database", "sql", "query", "data"],
    requiresApproval: true,
  },

  // ---------------------------------------------------------------------------
  // File â€” Local File Reader
  // ---------------------------------------------------------------------------
  {
    id: "local-file-reader",
    name: "Local File Reader",
    description: "Read and process files from the local filesystem. Supports text, JSON, CSV, and binary files",
    category: "data",
    icon: "ðŸ“‚",
    requiresCredentials: false,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
        encoding: {
          type: "string",
          description: "File encoding",
          enum: ["utf-8", "ascii", "binary", "base64"],
          default: "utf-8",
        },
        parseAs: {
          type: "string",
          description: "Parse file content as",
          enum: ["text", "json", "csv", "lines"],
          default: "text",
        },
      },
      required: ["path"],
    },
    tags: ["file", "read", "local", "filesystem"],
    requiresApproval: false,
  },
];

// ============================================================================
// Catalog Helpers
// ============================================================================

export function getToolsByCategory(category: ToolCategory): CatalogTool[] {
  return AGENT_TOOL_CATALOG.filter((t) => t.category === category);
}

export function getToolById(id: string): CatalogTool | undefined {
  return AGENT_TOOL_CATALOG.find((t) => t.id === id);
}

export function getToolsByTag(tag: string): CatalogTool[] {
  return AGENT_TOOL_CATALOG.filter((t) => t.tags.includes(tag));
}

export function searchCatalog(query: string): CatalogTool[] {
  const q = query.toLowerCase();
  return AGENT_TOOL_CATALOG.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q))
  );
}

export const TOOL_CATEGORIES: { id: ToolCategory; label: string; icon: string }[] = [
  { id: "knowledge", label: "Knowledge & RAG", icon: "ðŸ”" },
  { id: "document", label: "Documents", icon: "ðŸ“„" },
  { id: "search", label: "Search", icon: "ðŸŒ" },
  { id: "ai", label: "AI / LLM", icon: "ðŸ¤–" },
  { id: "communication", label: "Communication", icon: "ðŸ“§" },
  { id: "data", label: "Data", icon: "ðŸ“Š" },
  { id: "file-conversion", label: "File Conversion", icon: "ðŸ“‘" },
  { id: "analysis", label: "Analysis", icon: "âš–ï¸" },
  { id: "integration", label: "Integration", icon: "ðŸŒ" },
  { id: "custom", label: "Custom", icon: "ðŸ”§" },
];
