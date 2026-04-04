/**
 * Joy Assistant Knowledge Base
 *
 * Structured map of every JoyCreate platform feature with descriptions,
 * routes, capabilities, and how-to guides. This runs in the **main process**
 * and is injected into the AI system prompt so the assistant has full
 * platform awareness without needing extra API calls for basic questions.
 */

import type {
  AssistantIntent,
  AssistantPageContext,
  AssistantSuggestion,
} from "@/types/joy_assistant_types";

// ============================================================================
// Feature Catalog
// ============================================================================

export interface PlatformFeature {
  id: string;
  name: string;
  route: string;
  /** Short one-liner */
  summary: string;
  /** Detailed description for the AI */
  description: string;
  /** Key things a user can do here */
  capabilities: string[];
  /** Step-by-step guide */
  howToUse: string[];
  /** Keywords for fuzzy matching */
  keywords: string[];
  /** Related feature IDs */
  related: string[];
}

const FEATURES: PlatformFeature[] = [
  {
    id: "hub",
    name: "Hub",
    route: "/hub",
    summary: "Your personal dashboard — at-a-glance overview of everything.",
    description:
      "The Hub is the main dashboard showing recent apps, agent activity, quick actions, and system status. It's the first thing you see after launching JoyCreate.",
    capabilities: [
      "View recent apps and chats",
      "Quick-launch common actions",
      "See system health and service status",
      "Access quick links to all features",
    ],
    howToUse: [
      "Open JoyCreate — the Hub loads automatically.",
      "Click any recent app card to jump into it.",
      "Use the quick-action buttons to create a new app, agent, or workflow.",
    ],
    keywords: ["home", "dashboard", "overview", "start", "main"],
    related: ["chat", "agents", "marketplace"],
  },
  {
    id: "chat",
    name: "Chat",
    route: "/chat",
    summary: "AI-powered chat for building apps, coding, and brainstorming.",
    description:
      "The Chat page lets you have streaming conversations with AI models. You can attach files, select components, use code generation, and preview live. This is the heart of app creation in JoyCreate.",
    capabilities: [
      "Stream AI responses in real-time",
      "Attach files and images to messages",
      "Select UI components for targeted edits",
      "Preview generated code live",
      "Switch between AI models",
      "Export chat history",
    ],
    howToUse: [
      "Navigate to Chat from the sidebar.",
      "Type your prompt in the input field at the bottom.",
      "Press Enter or click Send to stream a response.",
      "Attach files by clicking the paperclip icon.",
      "Toggle the preview panel to see live output.",
    ],
    keywords: ["ai", "conversation", "prompt", "code", "build", "message", "ask"],
    related: ["hub", "agents", "documents"],
  },
  {
    id: "library",
    name: "Library",
    route: "/library",
    summary: "Your personal file bookshelf with decentralized storage options.",
    description:
      "The Library lets you upload, organize, and manage files. You can store files locally, pin them to IPFS via Helia, or archive to Arweave for permanent storage. It supports all file types.",
    capabilities: [
      "Upload and organize files",
      "Store locally, to IPFS, or to Arweave",
      "Search and filter by type",
      "Preview files inline",
      "Share files with other users",
    ],
    howToUse: [
      "Go to Library in the sidebar.",
      "Click 'Upload' to add files.",
      "Right-click a file for storage options (IPFS, Arweave).",
      "Use the search bar to find files by name.",
    ],
    keywords: ["files", "upload", "storage", "ipfs", "arweave", "documents", "media"],
    related: ["documents", "data-vault"],
  },
  {
    id: "marketplace",
    name: "Marketplace",
    route: "/marketplace",
    summary: "Browse, search, and install assets from JoyMarketplace.",
    description:
      "The Marketplace Explorer lets you discover apps, agents, workflows, datasets, models, templates, and plugins published by the community. You can filter by category, pricing, and type, then install assets directly into your workspace.",
    capabilities: [
      "Search assets by keyword",
      "Filter by category, type, and pricing model",
      "Sort by popular, recent, rating, or price",
      "View detailed asset pages with screenshots and reviews",
      "Install assets directly",
      "Browse featured and trending items",
    ],
    howToUse: [
      "Go to Marketplace in the sidebar.",
      "Use the search bar to find what you need.",
      "Apply filters (category, type, pricing) to narrow results.",
      "Click an asset card for its details page.",
      "Click 'Install' to add it to your workspace.",
    ],
    keywords: ["browse", "install", "download", "apps", "agents", "store", "shop", "find", "discover"],
    related: ["creator-dashboard", "asset-studio", "nft-marketplace"],
  },
  {
    id: "agents",
    name: "Agents",
    route: "/agents",
    summary: "Create, train, and deploy AI agents that can act autonomously.",
    description:
      "The Agents page lets you build custom AI agents with specific skills, tools, and system prompts. Agents can browse the web, call APIs, generate code, analyze data, and integrate with n8n workflows. You can test, deploy, and publish them to the marketplace.",
    capabilities: [
      "Create agents with custom system prompts",
      "Assign tools and capabilities",
      "Connect agents to workflows via n8n",
      "Test agents in a chat interface",
      "Deploy agents locally or to the cloud",
      "Publish agents to the marketplace",
    ],
    howToUse: [
      "Go to Agents in the sidebar.",
      "Click 'New Agent' to start the creation wizard.",
      "Give your agent a name, description, and system prompt.",
      "Add tools (web search, code execution, API calls, etc.).",
      "Test the agent in the built-in chat panel.",
      "Click 'Deploy' to make it active, or 'Publish' to list on the marketplace.",
    ],
    keywords: ["agent", "ai agent", "bot", "autonomous", "tools", "deploy", "create agent"],
    related: ["agent-swarm", "workflows", "marketplace"],
  },
  {
    id: "agent-swarm",
    name: "Agent Swarm",
    route: "/agent-swarm",
    summary: "Coordinate multiple agents working together on complex tasks.",
    description:
      "Agent Swarm lets you orchestrate groups of AI agents that collaborate, replicate, and learn from each other. Supports coordinator, worker, specialist, scout, synthesizer, validator, witness, and replicator roles.",
    capabilities: [
      "Create swarms of cooperating agents",
      "Define agent roles and hierarchies",
      "Monitor swarm execution in real-time",
      "Witness-based learning across agents",
      "Self-replicating agents for scaling",
    ],
    howToUse: [
      "Go to Agent Swarm in the sidebar.",
      "Click 'Create Swarm' to define a new swarm.",
      "Assign roles to each agent in the swarm.",
      "Submit a task and watch agents collaborate.",
      "Review results and agent performance metrics.",
    ],
    keywords: ["swarm", "multi-agent", "orchestrate", "coordinate", "team"],
    related: ["agents", "workflows"],
  },
  {
    id: "workflows",
    name: "Workflows",
    route: "/workflows",
    summary: "Visual automation workflows powered by n8n.",
    description:
      "Workflows lets you create automation pipelines using a visual node-based editor (powered by n8n). Connect triggers, AI nodes, data transformations, and external services to automate repetitive tasks.",
    capabilities: [
      "Visual drag-and-drop workflow editor",
      "200+ built-in integration nodes",
      "AI-powered nodes (Ollama, OpenAI, Anthropic)",
      "Schedule and trigger workflows",
      "Monitor workflow execution",
      "Publish workflows to the marketplace",
    ],
    howToUse: [
      "Go to Workflows in the sidebar.",
      "Click 'New Workflow' to open the visual editor.",
      "Drag nodes from the palette onto the canvas.",
      "Connect nodes to define the data flow.",
      "Click 'Execute' to test, then 'Activate' to run automatically.",
    ],
    keywords: ["automation", "n8n", "workflow", "pipeline", "trigger", "nodes", "integrate"],
    related: ["agents", "data-studio"],
  },
  {
    id: "documents",
    name: "Documents",
    route: "/documents",
    summary: "Create word docs, spreadsheets, and presentations with AI assistance.",
    description:
      "The Documents page lets you create and manage office documents using LibreOffice integration. Supports word processor docs, spreadsheets, and presentations. AI can generate content, fill templates, and export in multiple formats (PDF, DOCX, XLSX, PPTX, HTML, CSV).",
    capabilities: [
      "Create word documents, spreadsheets, and presentations",
      "AI-powered content generation",
      "Use templates for common document types",
      "Export to PDF, DOCX, XLSX, PPTX, HTML, TXT, CSV",
      "Search and filter your documents",
    ],
    howToUse: [
      "Go to Documents in the sidebar.",
      "Click 'New Document', 'New Spreadsheet', or 'New Presentation'.",
      "Enter a name for your document.",
      "Optionally use AI generation by clicking the AI icon and entering a prompt.",
      "Your document opens in the built-in editor.",
      "Use the export button to save in different formats.",
    ],
    keywords: ["document", "doc", "word", "spreadsheet", "excel", "presentation", "powerpoint", "slides", "pdf", "write", "report"],
    related: ["library", "asset-studio"],
  },
  {
    id: "local-ai",
    name: "Local AI",
    route: "/local-ai",
    summary: "Manage local AI models — Ollama, LM Studio, llama.cpp, vLLM.",
    description:
      "The Local AI page shows all detected local model providers and their models. You can download new models, check health status, run benchmarks, and configure which models are available for the smart router.",
    capabilities: [
      "View all local model providers and their status",
      "Download models from Ollama or HuggingFace",
      "Run performance benchmarks",
      "Configure model priorities and defaults",
      "Health-check providers",
    ],
    howToUse: [
      "Go to Local AI in the sidebar.",
      "Check which providers are online (green dot = healthy).",
      "Click 'Download Model' to pull a new model from Ollama.",
      "Click 'Benchmark' to test a model's speed.",
      "Set a model as default for the smart router.",
    ],
    keywords: ["local", "ollama", "llama", "model", "download", "gpu", "inference", "vllm", "lm studio"],
    related: ["chat", "agents"],
  },
  {
    id: "data-studio",
    name: "Data Studio",
    route: "/data-studio",
    summary: "Transform, clean, and manage datasets for AI training and analysis.",
    description:
      "Data Studio is a comprehensive data management platform. Import data from files, APIs, or databases. Clean, transform, and annotate datasets. Build data pipelines with scheduling. Export training-ready data for AI models.",
    capabilities: [
      "Import data from CSV, JSON, databases, APIs",
      "Clean and transform data with visual pipelines",
      "Annotate datasets for training",
      "Version control for datasets",
      "Data lineage tracking",
      "Quality analysis and validation",
      "Export for AI training",
    ],
    howToUse: [
      "Go to Data Studio in the sidebar.",
      "Click 'Import' to bring in data from a file or source.",
      "Use the transform panel to clean and reshape your data.",
      "Set up a pipeline for repeatable transformations.",
      "Export the processed data in your preferred format.",
    ],
    keywords: ["data", "dataset", "transform", "clean", "annotate", "pipeline", "import", "csv", "training data"],
    related: ["web-scraping", "knowledge-base", "documents"],
  },
  {
    id: "web-scraping",
    name: "Web Scraping",
    route: "/web-scraping",
    summary: "Scrape websites with AI-powered extraction and persistence.",
    description:
      "Web Scraping lets you extract data from any website using multiple engines (cheerio, Playwright, AI extraction). Supports auto-tagging, pagination, and scheduled scrapes. Results can be saved directly to datasets.",
    capabilities: [
      "Scrape websites with multiple engines",
      "AI-powered content extraction",
      "Handle pagination automatically",
      "Schedule recurring scrapes",
      "Export to datasets for training",
    ],
    howToUse: [
      "Go to Web Scraping in the sidebar.",
      "Enter a URL to scrape.",
      "Choose an extraction engine (auto, cheerio, Playwright, AI).",
      "Configure selectors or let AI figure it out.",
      "Click 'Scrape' and review the results.",
      "Save to a dataset or export.",
    ],
    keywords: ["scrape", "crawl", "extract", "web", "website", "url", "spider"],
    related: ["data-studio", "knowledge-base"],
  },
  {
    id: "knowledge-base",
    name: "Knowledge Base",
    route: "/knowledge-base",
    summary: "Build searchable knowledge bases with vector-powered semantic search.",
    description:
      "Knowledge Base lets you ingest documents, web pages, and files into a vector store for semantic search and RAG (Retrieval Augmented Generation). Agents and chats can query the knowledge base for contextual answers.",
    capabilities: [
      "Ingest documents, URLs, and files",
      "Automatic chunking and embedding",
      "Semantic search across all content",
      "RAG integration with agents and chat",
      "Organize into collections",
    ],
    howToUse: [
      "Go to Knowledge Base in the sidebar.",
      "Click 'Add Source' to ingest a document or URL.",
      "Wait for the embedding pipeline to process it.",
      "Search using natural language queries.",
      "Connect a knowledge base to an agent for RAG.",
    ],
    keywords: ["knowledge", "rag", "vector", "search", "semantic", "embed", "ingest"],
    related: ["data-studio", "agents", "library"],
  },
  {
    id: "asset-studio",
    name: "Asset Studio",
    route: "/asset-studio",
    summary: "Create and manage publishable digital assets.",
    description:
      "Asset Studio is your workspace for creating algorithms, connectors, datasets, embeddings, models, plugins, prompts, schemas, templates, training data, UI components, and workflows. Assets can be published to the marketplace.",
    capabilities: [
      "Create 13 types of digital assets",
      "Manage asset metadata and versions",
      "Bundle assets for distribution",
      "Publish directly to JoyMarketplace",
      "Track download and rating stats",
    ],
    howToUse: [
      "Go to Asset Studio in the sidebar.",
      "Click 'New Asset' and choose a type.",
      "Fill in the details (name, description, content).",
      "Click 'Publish' to list on the marketplace.",
    ],
    keywords: ["asset", "create", "publish", "plugin", "template", "component", "bundle"],
    related: ["marketplace", "creator-dashboard"],
  },
  {
    id: "creator-dashboard",
    name: "My Creations",
    route: "/creator",
    summary: "Unified dashboard for all your created apps, agents, workflows, your public creator profile, and more.",
    description:
      "My Creations aggregates everything you've built — apps, agents, workflows, datasets, and models — into one view. Includes your public creator profile, publish status, earnings breakdowns, and analytics.",
    capabilities: [
      "View all created assets across all types",
      "See publish status for each asset",
      "Track earnings by asset and by month",
      "View download and engagement analytics",
      "View and manage your public creator profile",
      "See published assets, download counts, and ratings",
    ],
    howToUse: [
      "Go to My Creations in the sidebar.",
      "Browse your assets by type or status.",
      "Click the Profile tab to see your public portfolio.",
      "Check the earnings tab for revenue data.",
    ],
    keywords: ["creations", "my assets", "dashboard", "earnings", "analytics", "creator", "profile", "portfolio"],
    related: ["marketplace", "asset-studio"],
  },
  {
    id: "p2p-chat",
    name: "P2P Chat",
    route: "/p2p-chat",
    summary: "Fully decentralized encrypted messaging with privacy-first design.",
    description:
      "P2P Chat is a wallet-to-wallet encrypted messenger. Messages are onion-routed through relay nodes for metadata privacy. Uses Double Ratchet encryption, decentralized TURN/STUN for WebRTC calls, and cover traffic to defeat timing analysis. No server ever sees your conversations.",
    capabilities: [
      "End-to-end encrypted messaging",
      "Onion-routed message delivery (3+ hops)",
      "Decentralized video/audio calls via WebRTC",
      "Group chats and channels",
      "Cover traffic for metadata privacy",
      "Meeting rooms and appointments",
    ],
    howToUse: [
      "Go to P2P Chat in the sidebar.",
      "Create your identity (linked to your wallet address).",
      "Click 'New Chat' to start a conversation with a wallet address.",
      "Type and send messages — they're encrypted automatically.",
      "Click the video icon to start a WebRTC call.",
    ],
    keywords: ["chat", "messaging", "p2p", "encrypted", "decentralized", "call", "video", "voice", "private"],
    related: ["hub"],
  },
  {
    id: "settings",
    name: "Settings",
    route: "/settings",
    summary: "Configure AI providers, API keys, theme, zoom, and more.",
    description:
      "Settings lets you configure your AI provider API keys, choose default models, set theme/zoom preferences, manage service connections (n8n, Ollama, Celestia), and control privacy levels for the smart router.",
    capabilities: [
      "Set API keys for OpenAI, Anthropic, and other providers",
      "Choose default AI models",
      "Configure theme (light/dark) and zoom level",
      "Manage external service connections",
      "Set smart router preferences (local vs. cloud bias)",
    ],
    howToUse: [
      "Click the gear icon at the bottom of the sidebar.",
      "Navigate through the settings tabs.",
      "Enter your API keys under 'Provider Settings'.",
      "Adjust the smart router preferences under 'AI Routing'.",
      "Changes are saved automatically.",
    ],
    keywords: ["settings", "configuration", "preferences", "api key", "theme", "dark mode", "provider", "model"],
    related: ["local-ai"],
  },
];

// Index for fast lookups
const featureById = new Map<string, PlatformFeature>();
const featuresByKeyword = new Map<string, PlatformFeature[]>();

function ensureIndex() {
  if (featureById.size > 0) return;
  for (const f of FEATURES) {
    featureById.set(f.id, f);
    for (const kw of f.keywords) {
      const lower = kw.toLowerCase();
      if (!featuresByKeyword.has(lower)) featuresByKeyword.set(lower, []);
      featuresByKeyword.get(lower)!.push(f);
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fuzzy-match a feature by name, keyword, or route.
 * Returns top matches sorted by relevance.
 */
export function findFeatures(query: string, limit = 5): PlatformFeature[] {
  ensureIndex();
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const scored: { feature: PlatformFeature; score: number }[] = [];

  for (const f of FEATURES) {
    let score = 0;

    // Exact name match
    if (f.name.toLowerCase() === q) score += 100;
    // Name contains query
    else if (f.name.toLowerCase().includes(q)) score += 60;

    // Route match
    if (f.route.includes(q)) score += 40;

    // Keyword match
    for (const kw of f.keywords) {
      if (kw.toLowerCase() === q) { score += 80; break; }
      if (kw.toLowerCase().includes(q) || q.includes(kw.toLowerCase())) score += 30;
    }

    // Summary / description substring
    if (f.summary.toLowerCase().includes(q)) score += 20;
    if (f.description.toLowerCase().includes(q)) score += 10;

    // Capability match
    for (const cap of f.capabilities) {
      if (cap.toLowerCase().includes(q)) { score += 15; break; }
    }

    if (score > 0) scored.push({ feature: f, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.feature);
}

/** Get a feature by its ID */
export function getFeature(featureId: string): PlatformFeature | undefined {
  ensureIndex();
  return featureById.get(featureId);
}

/** Get formatted how-to guide for a feature */
export function getFeatureGuide(featureId: string): string | null {
  const feature = getFeature(featureId);
  if (!feature) return null;

  const lines = [
    `# ${feature.name}`,
    "",
    feature.description,
    "",
    "## What you can do",
    ...feature.capabilities.map((c) => `- ${c}`),
    "",
    "## How to use it",
    ...feature.howToUse.map((s, i) => `${i + 1}. ${s}`),
    "",
    `**Route:** ${feature.route}`,
  ];

  if (feature.related.length > 0) {
    const relatedNames = feature.related
      .map((rId) => getFeature(rId)?.name)
      .filter(Boolean);
    lines.push("", `**Related:** ${relatedNames.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Get contextual suggestions for the current page.
 * Returns quick-action chips the user can click.
 */
export function getSuggestions(
  pageContext: AssistantPageContext,
): AssistantSuggestion[] {
  ensureIndex();
  const suggestions: AssistantSuggestion[] = [];
  const route = pageContext.route;

  // Feature-specific suggestions based on current route
  const current = FEATURES.find((f) => route.startsWith(f.route));

  if (current) {
    // Always offer to explain the current page
    suggestions.push({
      id: `explain-${current.id}`,
      text: `How do I use ${current.name}?`,
      intent: "explain",
      priority: 90,
    });
  }

  // Route-specific suggestions
  if (route.startsWith("/marketplace")) {
    suggestions.push(
      { id: "search-agents", text: "Find me an AI agent", intent: "search", priority: 80 },
      { id: "search-workflows", text: "Show popular workflows", intent: "search", priority: 70 },
    );
  } else if (route.startsWith("/agents")) {
    suggestions.push(
      { id: "create-agent", text: "Create a new agent", intent: "create", priority: 80 },
      { id: "explain-tools", text: "What tools can agents use?", intent: "explain", priority: 70 },
    );
  } else if (route.startsWith("/documents")) {
    suggestions.push(
      { id: "create-doc", text: "Create a document", intent: "create", priority: 80 },
      { id: "create-spreadsheet", text: "Create a spreadsheet", intent: "create", priority: 75 },
      { id: "create-presentation", text: "Create a presentation", intent: "create", priority: 70 },
    );
  } else if (route.startsWith("/creator")) {
    suggestions.push(
      { id: "publish-guide", text: "How do I publish to the marketplace?", intent: "explain", priority: 80 },
      { id: "earnings-info", text: "Show my earnings", intent: "navigate", priority: 70 },
    );
  } else if (route.startsWith("/settings")) {
    suggestions.push(
      { id: "set-api-key", text: "Help me set up my API keys", intent: "configure", priority: 80 },
      { id: "explain-routing", text: "How does smart routing work?", intent: "explain", priority: 70 },
    );
  } else if (route.startsWith("/chat")) {
    suggestions.push(
      { id: "chat-tips", text: "Tips for better AI responses", intent: "explain", priority: 80 },
      { id: "attach-files", text: "How do I attach files?", intent: "explain", priority: 70 },
    );
  } else if (route.startsWith("/data-studio") || route.startsWith("/web-scraping")) {
    suggestions.push(
      { id: "import-data", text: "Help me import data", intent: "explain", priority: 80 },
      { id: "scrape-guide", text: "How to scrape a website", intent: "explain", priority: 70 },
    );
  }

  // Generic suggestions (always available, lower priority)
  suggestions.push(
    { id: "nav-marketplace", text: "Go to Marketplace", intent: "navigate", priority: 20 },
    { id: "nav-agents", text: "Go to Agents", intent: "navigate", priority: 15 },
    { id: "whatcanido", text: "What can JoyCreate do?", intent: "explain", priority: 10 },
  );

  // Sort by priority, deduplicate
  suggestions.sort((a, b) => b.priority - a.priority);
  return suggestions.slice(0, 8);
}

// ============================================================================
// System Prompt Builder
// ============================================================================

/**
 * Builds the AI system prompt with injected platform knowledge.
 * Gives the model full context about the user's current page,
 * available actions, and the platform's capabilities.
 */
export function buildSystemPrompt(
  pageContext: AssistantPageContext,
  mode: "auto" | "do-it-for-me" | "guide-me",
): string {
  ensureIndex();

  // Find the current page's feature for extra context
  const current = FEATURES.find((f) => pageContext.route.startsWith(f.route));
  const currentGuide = current ? getFeatureGuide(current.id) : null;

  const allFeatureSummaries = FEATURES.map(
    (f) => `- **${f.name}** (${f.route}): ${f.summary}`,
  ).join("\n");

  const elementList =
    pageContext.availableElements.length > 0
      ? `Available interactive elements on this page: ${pageContext.availableElements.map((e) => `${e.id} (${e.type}: ${e.label})`).join(", ")}`
      : "No annotated interactive elements detected on this page.";

  const modeInstructions = {
    auto: `You decide the best approach: either perform actions directly OR guide the user step-by-step, depending on the request complexity and risk.`,
    "do-it-for-me": `You should perform actions directly — navigate, fill fields, click buttons, create documents. Return action objects in your response.`,
    "guide-me": `You should guide the user step-by-step. Highlight elements, show tooltips, and explain what to do — but don't perform actions automatically. Return highlight/tooltip actions instead.`,
  };

  return `You are **Joy Assistant**, the built-in AI helper for JoyCreate — the world's most powerful decentralized creator platform. You are friendly, knowledgeable, and incredibly helpful.

## Your capabilities
- Navigate the user to any page in the app
- Fill in form fields and click buttons on the current page
- Create documents (word, spreadsheet, presentation) with AI content
- Search the marketplace for assets (agents, workflows, models, etc.)
- Explain any feature in detail with step-by-step guides
- Help configure settings and API keys
- Analyze creator stats and earnings

## Interaction mode
${modeInstructions[mode]}

## Action format
When you want to perform an action, include a JSON actions array in your response wrapped in <actions>...</actions> tags. Each action is one of:
- \`{"type":"navigate","route":"/path","label":"Description"}\`
- \`{"type":"fill","fieldId":"element-id","value":"text","label":"Field name"}\`
- \`{"type":"click","targetId":"element-id","label":"Button name"}\`
- \`{"type":"highlight","targetId":"element-id","label":"Element","tooltip":"What to do"}\`
- \`{"type":"tooltip","targetId":"element-id","content":"Tip text"}\`
- \`{"type":"create-document","documentType":"document|spreadsheet|presentation","name":"Doc name","aiPrompt":"Optional prompt"}\`
- \`{"type":"search","target":"marketplace|library|knowledge-base|agents|workflows","query":"search terms"}\`
- \`{"type":"open-dialog","dialogId":"dialog-name","label":"Dialog title"}\`

Only use fieldId/targetId values from the available elements list below. Do not invent element IDs.

## Current context
- **Page:** ${pageContext.pageTitle} (${pageContext.route})
- ${elementList}
${current ? `- **Current feature:** ${current.name} — ${current.summary}` : ""}

${currentGuide ? `## Current page guide\n${currentGuide}` : ""}

## Platform features
${allFeatureSummaries}

## Rules
- Be concise but thorough. Use markdown formatting.
- When the user asks "how to" do something, provide step-by-step instructions.
- When the user asks to "go to" somewhere, return a navigate action.
- When the user asks to "create" something, determine if it's a document, agent, workflow, or asset and act accordingly.
- Prefer local actions (filling fields, navigating) over telling the user what to click.
- Never make up information about the platform. Only reference features that exist in the catalog above.
- If you're unsure, ask a clarifying question rather than guessing.
`;
}
