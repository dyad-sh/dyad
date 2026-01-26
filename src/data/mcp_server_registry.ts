/**
 * MCP Server Registry
 * A comprehensive catalog of available MCP servers for JoyCreate
 */

export interface McpServerConfig {
  type: "stdio" | "http";
  command?: string;
  url?: string;
  env?: Record<string, string>;
}

export interface McpServerRegistryEntry {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  category: McpServerCategory;
  config: McpServerConfig;
  icon?: string;
  website?: string;
  github?: string;
  featured?: boolean;
  tags?: string[];
  author?: string;
  version?: string;
  requiresAuth?: boolean;
  envVars?: {
    key: string;
    description: string;
    required: boolean;
    placeholder?: string;
  }[];
}

export type McpServerCategory =
  | "featured"
  | "ai-assistants"
  | "development"
  | "databases"
  | "cloud-services"
  | "productivity"
  | "analytics"
  | "documentation"
  | "code-platforms"
  | "deployment"
  | "browser-automation"
  | "data-processing"
  | "communication"
  | "other";

export const MCP_CATEGORIES: { id: McpServerCategory; name: string; icon: string }[] = [
  { id: "featured", name: "Featured", icon: "⭐" },
  { id: "ai-assistants", name: "AI Assistants", icon: "🤖" },
  { id: "development", name: "Development Tools", icon: "🛠️" },
  { id: "code-platforms", name: "Code Platforms", icon: "💻" },
  { id: "databases", name: "Databases", icon: "🗄️" },
  { id: "cloud-services", name: "Cloud Services", icon: "☁️" },
  { id: "deployment", name: "Deployment", icon: "🚀" },
  { id: "browser-automation", name: "Browser Automation", icon: "🌐" },
  { id: "analytics", name: "Analytics", icon: "📊" },
  { id: "documentation", name: "Documentation", icon: "📚" },
  { id: "productivity", name: "Productivity", icon: "⚡" },
  { id: "data-processing", name: "Data Processing", icon: "🔄" },
  { id: "communication", name: "Communication", icon: "💬" },
  { id: "other", name: "Other", icon: "📦" },
];

export const MCP_SERVER_REGISTRY: McpServerRegistryEntry[] = [
  // ===== FEATURED SERVERS =====
  {
    id: "context7",
    name: "Context7",
    description: "Pulls up-to-date, version-specific documentation and code examples directly from the source.",
    longDescription: "Context7 is a powerful MCP server that provides real-time access to documentation and code examples. It automatically fetches the latest information from official sources, ensuring your AI assistant always has accurate, version-specific guidance.",
    category: "featured",
    featured: true,
    config: {
      type: "stdio",
      command: "npx -y @upstash/context7-mcp@latest",
    },
    website: "https://context7.com",
    tags: ["documentation", "code-examples", "real-time"],
    author: "Upstash",
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    description: "Debug web pages directly in Chrome with DevTools debugging capabilities and performance insights.",
    longDescription: "Access Chrome DevTools capabilities through MCP. Debug JavaScript, inspect DOM elements, analyze network requests, and measure performance metrics all through natural language commands.",
    category: "featured",
    featured: true,
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-chrome-devtools",
    },
    tags: ["debugging", "chrome", "devtools", "performance"],
    author: "Anthropic",
  },
  {
    id: "lovable",
    name: "Lovable",
    description: "Build beautiful web applications with AI-powered design and development assistance.",
    longDescription: "Lovable MCP server enables AI-assisted app building with a focus on beautiful design. Create stunning web applications with natural language commands, leveraging Lovable's design expertise.",
    category: "featured",
    featured: true,
    config: {
      type: "stdio",
      command: "npx -y @lovable/mcp-server",
    },
    website: "https://lovable.dev",
    tags: ["app-builder", "design", "web-development"],
    author: "Lovable",
    requiresAuth: true,
    envVars: [
      {
        key: "LOVABLE_API_KEY",
        description: "Your Lovable API key",
        required: true,
        placeholder: "lvbl_...",
      },
    ],
  },
  {
    id: "replit",
    name: "Replit",
    description: "Create, run, and deploy code directly on Replit's cloud development platform.",
    longDescription: "Connect to Replit to create, edit, and run code in the cloud. Deploy applications, manage replits, and collaborate with others through AI-powered commands.",
    category: "featured",
    featured: true,
    config: {
      type: "stdio",
      command: "npx -y @replit/mcp-server",
    },
    website: "https://replit.com",
    github: "https://github.com/replit/replit-mcp",
    tags: ["cloud-ide", "deployment", "collaboration"],
    author: "Replit",
    requiresAuth: true,
    envVars: [
      {
        key: "REPLIT_API_KEY",
        description: "Your Replit API key",
        required: true,
        placeholder: "repl_...",
      },
    ],
  },

  // ===== CODE PLATFORMS =====
  {
    id: "github",
    name: "GitHub",
    description: "Manage repositories, issues, pull requests, and more on GitHub.",
    longDescription: "Full GitHub integration through MCP. Create repositories, manage issues, review pull requests, search code, and automate workflows.",
    category: "code-platforms",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-github",
    },
    website: "https://github.com",
    tags: ["git", "version-control", "collaboration"],
    author: "Anthropic",
    requiresAuth: true,
    envVars: [
      {
        key: "GITHUB_TOKEN",
        description: "GitHub Personal Access Token",
        required: true,
        placeholder: "ghp_...",
      },
    ],
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Manage GitLab projects, merge requests, and CI/CD pipelines.",
    longDescription: "Access GitLab functionality through MCP. Manage projects, create merge requests, monitor CI/CD pipelines, and handle issues.",
    category: "code-platforms",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-gitlab",
    },
    website: "https://gitlab.com",
    tags: ["git", "version-control", "ci-cd"],
    author: "Community",
    requiresAuth: true,
    envVars: [
      {
        key: "GITLAB_TOKEN",
        description: "GitLab Personal Access Token",
        required: true,
        placeholder: "glpat-...",
      },
      {
        key: "GITLAB_URL",
        description: "GitLab instance URL (optional for self-hosted)",
        required: false,
        placeholder: "https://gitlab.com",
      },
    ],
  },
  {
    id: "stackblitz",
    name: "StackBlitz",
    description: "Create and run web development projects in the browser with WebContainers.",
    longDescription: "StackBlitz MCP server allows you to create instant development environments, run full-stack applications in the browser, and share projects with one click.",
    category: "code-platforms",
    config: {
      type: "stdio",
      command: "npx -y @stackblitz/mcp-server",
    },
    website: "https://stackblitz.com",
    tags: ["browser-ide", "webcontainers", "instant-dev"],
    author: "StackBlitz",
  },
  {
    id: "codesandbox",
    name: "CodeSandbox",
    description: "Create and manage cloud development environments and sandboxes.",
    longDescription: "CodeSandbox MCP enables cloud-based development. Create sandboxes, manage projects, and collaborate on code in real-time.",
    category: "code-platforms",
    config: {
      type: "stdio",
      command: "npx -y @codesandbox/mcp-server",
    },
    website: "https://codesandbox.io",
    tags: ["cloud-ide", "sandbox", "collaboration"],
    author: "CodeSandbox",
    requiresAuth: true,
    envVars: [
      {
        key: "CODESANDBOX_API_KEY",
        description: "CodeSandbox API key",
        required: true,
        placeholder: "csb_...",
      },
    ],
  },

  // ===== DATABASES =====
  {
    id: "neon",
    name: "Neon",
    description: "Manage Neon Postgres databases with serverless scaling.",
    longDescription: "Full Neon database management through MCP. Create databases, run queries, manage branches, and handle migrations for your serverless Postgres.",
    category: "databases",
    config: {
      type: "stdio",
      command: "npx -y @neon/mcp-server-neon",
    },
    website: "https://neon.tech",
    tags: ["postgres", "serverless", "database"],
    author: "Neon",
    requiresAuth: true,
    envVars: [
      {
        key: "NEON_API_KEY",
        description: "Neon API key",
        required: true,
        placeholder: "neon_...",
      },
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Manage Supabase projects, databases, authentication, and storage.",
    longDescription: "Complete Supabase integration. Manage PostgreSQL databases, authentication, real-time subscriptions, storage buckets, and edge functions.",
    category: "databases",
    config: {
      type: "stdio",
      command: "npx -y @supabase/mcp-server",
    },
    website: "https://supabase.com",
    tags: ["postgres", "auth", "realtime", "storage"],
    author: "Supabase",
    requiresAuth: true,
    envVars: [
      {
        key: "SUPABASE_ACCESS_TOKEN",
        description: "Supabase access token",
        required: true,
        placeholder: "sbp_...",
      },
    ],
  },
  {
    id: "planetscale",
    name: "PlanetScale",
    description: "Manage PlanetScale MySQL databases with branching and deploy requests.",
    longDescription: "PlanetScale MCP server provides MySQL database management with Git-like branching, safe schema migrations, and non-blocking deploys.",
    category: "databases",
    config: {
      type: "stdio",
      command: "npx -y @planetscale/mcp-server",
    },
    website: "https://planetscale.com",
    tags: ["mysql", "branching", "migrations"],
    author: "PlanetScale",
    requiresAuth: true,
    envVars: [
      {
        key: "PLANETSCALE_TOKEN",
        description: "PlanetScale service token",
        required: true,
        placeholder: "pscale_tkn_...",
      },
    ],
  },
  {
    id: "mongodb",
    name: "MongoDB Atlas",
    description: "Manage MongoDB Atlas clusters, databases, and collections.",
    longDescription: "MongoDB Atlas MCP integration for managing cloud databases. Create clusters, manage collections, run aggregations, and handle indexes.",
    category: "databases",
    config: {
      type: "stdio",
      command: "npx -y @mongodb/mcp-server",
    },
    website: "https://mongodb.com/atlas",
    tags: ["nosql", "document-db", "cloud"],
    author: "MongoDB",
    requiresAuth: true,
    envVars: [
      {
        key: "MONGODB_API_KEY",
        description: "MongoDB Atlas API key",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "upstash",
    name: "Upstash",
    description: "Manage Upstash Redis and Kafka with serverless data services.",
    longDescription: "Upstash MCP provides access to serverless Redis and Kafka. Manage keys, run commands, and handle event streaming through natural language.",
    category: "databases",
    config: {
      type: "stdio",
      command: "npx -y @upstash/mcp-server",
    },
    website: "https://upstash.com",
    tags: ["redis", "kafka", "serverless"],
    author: "Upstash",
    requiresAuth: true,
    envVars: [
      {
        key: "UPSTASH_REDIS_URL",
        description: "Upstash Redis REST URL",
        required: true,
        placeholder: "https://...",
      },
      {
        key: "UPSTASH_REDIS_TOKEN",
        description: "Upstash Redis REST token",
        required: true,
        placeholder: "",
      },
    ],
  },

  // ===== DEPLOYMENT =====
  {
    id: "netlify",
    name: "Netlify",
    description: "Build, deploy, and manage sites on Netlify's edge network.",
    longDescription: "Deploy and manage web projects on Netlify. Handle continuous deployment, serverless functions, edge computing, and form submissions.",
    category: "deployment",
    config: {
      type: "stdio",
      command: "npx -y @netlify/mcp-server",
    },
    website: "https://netlify.com",
    tags: ["hosting", "serverless", "edge", "jamstack"],
    author: "Netlify",
    requiresAuth: true,
    envVars: [
      {
        key: "NETLIFY_AUTH_TOKEN",
        description: "Netlify personal access token",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Deploy and manage projects on Vercel's edge network.",
    longDescription: "Full Vercel integration for deploying frontend applications, serverless functions, and edge middleware. Manage domains, environment variables, and team projects.",
    category: "deployment",
    config: {
      type: "stdio",
      command: "npx -y @vercel/mcp-server",
    },
    website: "https://vercel.com",
    tags: ["hosting", "serverless", "edge", "nextjs"],
    author: "Vercel",
    requiresAuth: true,
    envVars: [
      {
        key: "VERCEL_TOKEN",
        description: "Vercel access token",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "railway",
    name: "Railway",
    description: "Deploy and manage applications on Railway's cloud platform.",
    longDescription: "Railway MCP for deploying full-stack applications. Manage projects, services, databases, and environment variables through natural language.",
    category: "deployment",
    config: {
      type: "stdio",
      command: "npx -y @railway/mcp-server",
    },
    website: "https://railway.app",
    tags: ["hosting", "databases", "full-stack"],
    author: "Railway",
    requiresAuth: true,
    envVars: [
      {
        key: "RAILWAY_API_TOKEN",
        description: "Railway API token",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "render",
    name: "Render",
    description: "Deploy web services, databases, and static sites on Render.",
    longDescription: "Render MCP enables deployment of web services, static sites, cron jobs, and managed databases. Handle auto-scaling and environment configuration.",
    category: "deployment",
    config: {
      type: "stdio",
      command: "npx -y @render/mcp-server",
    },
    website: "https://render.com",
    tags: ["hosting", "databases", "auto-scaling"],
    author: "Render",
    requiresAuth: true,
    envVars: [
      {
        key: "RENDER_API_KEY",
        description: "Render API key",
        required: true,
        placeholder: "rnd_...",
      },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Manage Cloudflare Workers, Pages, R2, and DNS settings.",
    longDescription: "Cloudflare MCP for managing edge workers, static sites on Pages, R2 storage buckets, KV namespaces, and DNS configurations.",
    category: "deployment",
    config: {
      type: "stdio",
      command: "npx -y @cloudflare/mcp-server",
    },
    website: "https://cloudflare.com",
    tags: ["edge", "workers", "cdn", "dns"],
    author: "Cloudflare",
    requiresAuth: true,
    envVars: [
      {
        key: "CLOUDFLARE_API_TOKEN",
        description: "Cloudflare API token",
        required: true,
        placeholder: "",
      },
      {
        key: "CLOUDFLARE_ACCOUNT_ID",
        description: "Cloudflare account ID",
        required: true,
        placeholder: "",
      },
    ],
  },

  // ===== BROWSER AUTOMATION =====
  {
    id: "browserbase",
    name: "Browserbase",
    description: "Headless browser sessions for AI agents with full web interaction capabilities.",
    longDescription: "Browserbase provides headless browser infrastructure for AI agents. Automate web interactions, scrape data, fill forms, and capture screenshots.",
    category: "browser-automation",
    config: {
      type: "stdio",
      command: "npx -y @browserbase/mcp-server",
    },
    website: "https://browserbase.com",
    tags: ["headless-browser", "automation", "scraping"],
    author: "Browserbase",
    requiresAuth: true,
    envVars: [
      {
        key: "BROWSERBASE_API_KEY",
        description: "Browserbase API key",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Browser automation with Playwright for testing and web scraping.",
    longDescription: "Playwright MCP enables browser automation across Chromium, Firefox, and WebKit. Perfect for E2E testing, web scraping, and automated interactions.",
    category: "browser-automation",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-playwright",
    },
    tags: ["testing", "automation", "cross-browser"],
    author: "Anthropic",
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Chrome automation for web scraping, testing, and PDF generation.",
    longDescription: "Puppeteer MCP provides Chrome DevTools Protocol control. Automate browser tasks, generate PDFs, capture screenshots, and scrape dynamic content.",
    category: "browser-automation",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-puppeteer",
    },
    tags: ["chrome", "automation", "pdf"],
    author: "Anthropic",
  },

  // ===== CLOUD SERVICES =====
  {
    id: "aws",
    name: "AWS",
    description: "Manage AWS services including S3, Lambda, EC2, and more.",
    longDescription: "Comprehensive AWS integration through MCP. Manage S3 buckets, Lambda functions, EC2 instances, DynamoDB tables, and other AWS services.",
    category: "cloud-services",
    config: {
      type: "stdio",
      command: "npx -y @aws/mcp-server",
    },
    website: "https://aws.amazon.com",
    tags: ["cloud", "s3", "lambda", "ec2"],
    author: "AWS",
    requiresAuth: true,
    envVars: [
      {
        key: "AWS_ACCESS_KEY_ID",
        description: "AWS access key ID",
        required: true,
        placeholder: "AKIA...",
      },
      {
        key: "AWS_SECRET_ACCESS_KEY",
        description: "AWS secret access key",
        required: true,
        placeholder: "",
      },
      {
        key: "AWS_REGION",
        description: "AWS region (e.g., us-east-1)",
        required: false,
        placeholder: "us-east-1",
      },
    ],
  },
  {
    id: "gcp",
    name: "Google Cloud",
    description: "Manage Google Cloud Platform services and resources.",
    longDescription: "Google Cloud MCP for managing Cloud Storage, Cloud Functions, BigQuery, Compute Engine, and other GCP services through natural language.",
    category: "cloud-services",
    config: {
      type: "stdio",
      command: "npx -y @google-cloud/mcp-server",
    },
    website: "https://cloud.google.com",
    tags: ["cloud", "storage", "bigquery", "compute"],
    author: "Google",
    requiresAuth: true,
    envVars: [
      {
        key: "GOOGLE_APPLICATION_CREDENTIALS",
        description: "Path to Google Cloud credentials JSON file",
        required: true,
        placeholder: "/path/to/credentials.json",
      },
    ],
  },
  {
    id: "azure",
    name: "Azure",
    description: "Manage Microsoft Azure resources and services.",
    longDescription: "Azure MCP integration for managing storage accounts, virtual machines, Azure Functions, Cosmos DB, and other Azure services.",
    category: "cloud-services",
    config: {
      type: "stdio",
      command: "npx -y @azure/mcp-server",
    },
    website: "https://azure.microsoft.com",
    tags: ["cloud", "storage", "functions", "vms"],
    author: "Microsoft",
    requiresAuth: true,
    envVars: [
      {
        key: "AZURE_SUBSCRIPTION_ID",
        description: "Azure subscription ID",
        required: true,
        placeholder: "",
      },
      {
        key: "AZURE_TENANT_ID",
        description: "Azure tenant ID",
        required: true,
        placeholder: "",
      },
      {
        key: "AZURE_CLIENT_ID",
        description: "Azure client ID",
        required: true,
        placeholder: "",
      },
      {
        key: "AZURE_CLIENT_SECRET",
        description: "Azure client secret",
        required: true,
        placeholder: "",
      },
    ],
  },

  // ===== AI ASSISTANTS =====
  {
    id: "anthropic-tools",
    name: "Anthropic Tools",
    description: "Extended Claude capabilities with computer use and file operations.",
    longDescription: "Official Anthropic tools MCP server providing extended capabilities like computer use, file system access, and bash command execution.",
    category: "ai-assistants",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-tools",
    },
    website: "https://anthropic.com",
    tags: ["claude", "computer-use", "file-system"],
    author: "Anthropic",
  },
  {
    id: "openai-tools",
    name: "OpenAI Tools",
    description: "Access OpenAI APIs including GPT models, DALL-E, and Whisper.",
    longDescription: "OpenAI MCP server for accessing GPT models, image generation with DALL-E, speech-to-text with Whisper, and embeddings.",
    category: "ai-assistants",
    config: {
      type: "stdio",
      command: "npx -y @openai/mcp-server",
    },
    website: "https://openai.com",
    tags: ["gpt", "dall-e", "whisper", "embeddings"],
    author: "OpenAI",
    requiresAuth: true,
    envVars: [
      {
        key: "OPENAI_API_KEY",
        description: "OpenAI API key",
        required: true,
        placeholder: "sk-...",
      },
    ],
  },

  // ===== ANALYTICS =====
  {
    id: "amplitude",
    name: "Amplitude",
    description: "Behavior analytics and experimentation platform for product data insights.",
    longDescription: "Amplitude MCP for product analytics. Query user behavior data, create cohorts, analyze funnels, and manage A/B experiments.",
    category: "analytics",
    config: {
      type: "stdio",
      command: "npx -y @amplitude/mcp-server",
    },
    website: "https://amplitude.com",
    tags: ["analytics", "product", "experimentation"],
    author: "Amplitude",
    requiresAuth: true,
    envVars: [
      {
        key: "AMPLITUDE_API_KEY",
        description: "Amplitude API key",
        required: true,
        placeholder: "",
      },
      {
        key: "AMPLITUDE_SECRET_KEY",
        description: "Amplitude secret key",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "posthog",
    name: "PostHog",
    description: "Product analytics, feature flags, session recordings, and A/B testing.",
    longDescription: "PostHog MCP provides access to product analytics, feature flag management, session recordings analysis, and experiment management.",
    category: "analytics",
    config: {
      type: "stdio",
      command: "npx -y @posthog/mcp-server",
    },
    website: "https://posthog.com",
    tags: ["analytics", "feature-flags", "ab-testing"],
    author: "PostHog",
    requiresAuth: true,
    envVars: [
      {
        key: "POSTHOG_API_KEY",
        description: "PostHog personal API key",
        required: true,
        placeholder: "phx_...",
      },
      {
        key: "POSTHOG_HOST",
        description: "PostHog host URL",
        required: false,
        placeholder: "https://app.posthog.com",
      },
    ],
  },
  {
    id: "mixpanel",
    name: "Mixpanel",
    description: "Event analytics and user behavior tracking platform.",
    longDescription: "Mixpanel MCP for querying event data, analyzing user flows, creating cohorts, and managing engagement campaigns.",
    category: "analytics",
    config: {
      type: "stdio",
      command: "npx -y @mixpanel/mcp-server",
    },
    website: "https://mixpanel.com",
    tags: ["analytics", "events", "user-flows"],
    author: "Mixpanel",
    requiresAuth: true,
    envVars: [
      {
        key: "MIXPANEL_TOKEN",
        description: "Mixpanel project token",
        required: true,
        placeholder: "",
      },
    ],
  },

  // ===== DOCUMENTATION =====
  {
    id: "astro-docs",
    name: "Astro Docs",
    description: "Access to official Astro framework documentation.",
    longDescription: "Astro documentation MCP server providing up-to-date access to Astro framework guides, API references, and tutorials.",
    category: "documentation",
    config: {
      type: "stdio",
      command: "npx -y @astro/mcp-server-docs",
    },
    website: "https://astro.build",
    tags: ["astro", "framework", "docs"],
    author: "Astro",
  },
  {
    id: "nextjs-docs",
    name: "Next.js Docs",
    description: "Access to official Next.js documentation and examples.",
    longDescription: "Next.js documentation MCP providing access to App Router guides, API references, deployment instructions, and code examples.",
    category: "documentation",
    config: {
      type: "stdio",
      command: "npx -y @vercel/mcp-server-nextjs-docs",
    },
    website: "https://nextjs.org",
    tags: ["nextjs", "react", "docs"],
    author: "Vercel",
  },
  {
    id: "react-docs",
    name: "React Docs",
    description: "Access to official React documentation and patterns.",
    longDescription: "React documentation MCP for accessing hooks guides, component patterns, server components docs, and best practices.",
    category: "documentation",
    config: {
      type: "stdio",
      command: "npx -y @react/mcp-server-docs",
    },
    website: "https://react.dev",
    tags: ["react", "hooks", "components"],
    author: "Meta",
  },
  {
    id: "tailwind-docs",
    name: "Tailwind CSS Docs",
    description: "Access to Tailwind CSS documentation and utility classes.",
    longDescription: "Tailwind CSS documentation MCP providing access to utility class references, customization guides, and component examples.",
    category: "documentation",
    config: {
      type: "stdio",
      command: "npx -y @tailwindcss/mcp-server-docs",
    },
    website: "https://tailwindcss.com",
    tags: ["css", "tailwind", "styling"],
    author: "Tailwind Labs",
  },

  // ===== PRODUCTIVITY =====
  {
    id: "notion",
    name: "Notion",
    description: "Manage Notion pages, databases, and workspace content.",
    longDescription: "Notion MCP for creating and editing pages, querying databases, managing blocks, and organizing workspace content through AI commands.",
    category: "productivity",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-notion",
    },
    website: "https://notion.so",
    tags: ["notes", "databases", "wiki"],
    author: "Anthropic",
    requiresAuth: true,
    envVars: [
      {
        key: "NOTION_API_KEY",
        description: "Notion integration token",
        required: true,
        placeholder: "secret_...",
      },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    description: "Manage Linear issues, projects, and team workflows.",
    longDescription: "Linear MCP for issue tracking, project management, sprint planning, and team workflow automation through natural language.",
    category: "productivity",
    config: {
      type: "stdio",
      command: "npx -y @linear/mcp-server",
    },
    website: "https://linear.app",
    tags: ["issues", "projects", "agile"],
    author: "Linear",
    requiresAuth: true,
    envVars: [
      {
        key: "LINEAR_API_KEY",
        description: "Linear API key",
        required: true,
        placeholder: "lin_api_...",
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, manage channels, and interact with Slack workspaces.",
    longDescription: "Slack MCP for sending messages, creating channels, searching conversations, managing users, and automating workspace interactions.",
    category: "productivity",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-slack",
    },
    website: "https://slack.com",
    tags: ["messaging", "collaboration", "automation"],
    author: "Anthropic",
    requiresAuth: true,
    envVars: [
      {
        key: "SLACK_BOT_TOKEN",
        description: "Slack Bot User OAuth Token",
        required: true,
        placeholder: "xoxb-...",
      },
    ],
  },
  {
    id: "jira",
    name: "Jira",
    description: "Manage Jira issues, sprints, and project boards.",
    longDescription: "Jira MCP for issue creation and management, sprint planning, board management, and project tracking through AI commands.",
    category: "productivity",
    config: {
      type: "stdio",
      command: "npx -y @atlassian/mcp-server-jira",
    },
    website: "https://atlassian.com/jira",
    tags: ["issues", "agile", "project-management"],
    author: "Atlassian",
    requiresAuth: true,
    envVars: [
      {
        key: "JIRA_URL",
        description: "Jira instance URL",
        required: true,
        placeholder: "https://your-domain.atlassian.net",
      },
      {
        key: "JIRA_EMAIL",
        description: "Jira account email",
        required: true,
        placeholder: "you@example.com",
      },
      {
        key: "JIRA_API_TOKEN",
        description: "Jira API token",
        required: true,
        placeholder: "",
      },
    ],
  },

  // ===== COMMUNICATION =====
  {
    id: "discord",
    name: "Discord",
    description: "Manage Discord servers, channels, and send messages.",
    longDescription: "Discord MCP for bot interactions, message management, server administration, and community engagement automation.",
    category: "communication",
    config: {
      type: "stdio",
      command: "npx -y @discord/mcp-server",
    },
    website: "https://discord.com",
    tags: ["chat", "community", "bots"],
    author: "Discord",
    requiresAuth: true,
    envVars: [
      {
        key: "DISCORD_BOT_TOKEN",
        description: "Discord bot token",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "twilio",
    name: "Twilio",
    description: "Send SMS, make calls, and manage communication APIs.",
    longDescription: "Twilio MCP for sending SMS messages, making voice calls, managing phone numbers, and handling communication workflows.",
    category: "communication",
    config: {
      type: "stdio",
      command: "npx -y @twilio/mcp-server",
    },
    website: "https://twilio.com",
    tags: ["sms", "voice", "communication"],
    author: "Twilio",
    requiresAuth: true,
    envVars: [
      {
        key: "TWILIO_ACCOUNT_SID",
        description: "Twilio Account SID",
        required: true,
        placeholder: "AC...",
      },
      {
        key: "TWILIO_AUTH_TOKEN",
        description: "Twilio Auth Token",
        required: true,
        placeholder: "",
      },
    ],
  },

  // ===== DEVELOPMENT TOOLS =====
  {
    id: "convex",
    name: "Convex",
    description: "Build dynamic live-updating apps with Convex backend.",
    longDescription: "Convex MCP for managing your Convex deployment. Query tables, run functions, manage environment variables, and analyze logs.",
    category: "development",
    config: {
      type: "stdio",
      command: "npx -y @convex/mcp-server",
    },
    website: "https://convex.dev",
    tags: ["backend", "realtime", "database"],
    author: "Convex",
    requiresAuth: true,
    envVars: [
      {
        key: "CONVEX_DEPLOY_KEY",
        description: "Convex deployment key",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "auth0",
    name: "Auth0",
    description: "Manage Auth0 applications, users, and authentication flows.",
    longDescription: "Auth0 MCP for managing authentication. Create applications, manage users, configure login flows, and deploy Actions.",
    category: "development",
    config: {
      type: "stdio",
      command: "npx -y @auth0/mcp-server",
    },
    website: "https://auth0.com",
    tags: ["authentication", "identity", "security"],
    author: "Auth0",
    requiresAuth: true,
    envVars: [
      {
        key: "AUTH0_DOMAIN",
        description: "Auth0 domain",
        required: true,
        placeholder: "your-tenant.auth0.com",
      },
      {
        key: "AUTH0_CLIENT_ID",
        description: "Auth0 client ID",
        required: true,
        placeholder: "",
      },
      {
        key: "AUTH0_CLIENT_SECRET",
        description: "Auth0 client secret",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Monitor errors, performance, and application health with Sentry.",
    longDescription: "Sentry MCP for error tracking and performance monitoring. Query issues, manage releases, analyze performance data, and configure alerts.",
    category: "development",
    config: {
      type: "stdio",
      command: "npx -y @sentry/mcp-server",
    },
    website: "https://sentry.io",
    tags: ["monitoring", "errors", "performance"],
    author: "Sentry",
    requiresAuth: true,
    envVars: [
      {
        key: "SENTRY_AUTH_TOKEN",
        description: "Sentry auth token",
        required: true,
        placeholder: "",
      },
      {
        key: "SENTRY_ORG",
        description: "Sentry organization slug",
        required: true,
        placeholder: "",
      },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Manage Stripe payments, subscriptions, and customers.",
    longDescription: "Stripe MCP for payment processing. Create customers, manage subscriptions, handle invoices, and process refunds through AI commands.",
    category: "development",
    config: {
      type: "stdio",
      command: "npx -y @stripe/mcp-server",
    },
    website: "https://stripe.com",
    tags: ["payments", "subscriptions", "billing"],
    author: "Stripe",
    requiresAuth: true,
    envVars: [
      {
        key: "STRIPE_SECRET_KEY",
        description: "Stripe secret key",
        required: true,
        placeholder: "sk_...",
      },
    ],
  },

  // ===== DATA PROCESSING =====
  {
    id: "airtable",
    name: "Airtable",
    description: "Manage Airtable bases, tables, and records.",
    longDescription: "Airtable MCP for database operations. Create and query tables, manage records, handle attachments, and automate workflows.",
    category: "data-processing",
    config: {
      type: "stdio",
      command: "npx -y @airtable/mcp-server",
    },
    website: "https://airtable.com",
    tags: ["database", "spreadsheet", "automation"],
    author: "Airtable",
    requiresAuth: true,
    envVars: [
      {
        key: "AIRTABLE_API_KEY",
        description: "Airtable personal access token",
        required: true,
        placeholder: "pat...",
      },
    ],
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read and write data to Google Sheets spreadsheets.",
    longDescription: "Google Sheets MCP for spreadsheet operations. Read data, write cells, format sheets, and automate data processing tasks.",
    category: "data-processing",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-google-sheets",
    },
    website: "https://sheets.google.com",
    tags: ["spreadsheet", "data", "google"],
    author: "Anthropic",
    requiresAuth: true,
    envVars: [
      {
        key: "GOOGLE_SHEETS_CREDENTIALS",
        description: "Path to Google service account JSON",
        required: true,
        placeholder: "/path/to/credentials.json",
      },
    ],
  },
  {
    id: "snowflake",
    name: "Snowflake",
    description: "Query and manage Snowflake data warehouse.",
    longDescription: "Snowflake MCP for data warehousing. Run queries, manage tables, handle data loading, and analyze large datasets.",
    category: "data-processing",
    config: {
      type: "stdio",
      command: "npx -y @snowflake/mcp-server",
    },
    website: "https://snowflake.com",
    tags: ["data-warehouse", "sql", "analytics"],
    author: "Snowflake",
    requiresAuth: true,
    envVars: [
      {
        key: "SNOWFLAKE_ACCOUNT",
        description: "Snowflake account identifier",
        required: true,
        placeholder: "xy12345.us-east-1",
      },
      {
        key: "SNOWFLAKE_USER",
        description: "Snowflake username",
        required: true,
        placeholder: "",
      },
      {
        key: "SNOWFLAKE_PASSWORD",
        description: "Snowflake password",
        required: true,
        placeholder: "",
      },
    ],
  },

  // ===== FILE SYSTEM & LOCAL =====
  {
    id: "filesystem",
    name: "File System",
    description: "Read, write, and manage local files and directories.",
    longDescription: "File system MCP server for local file operations. Read and write files, create directories, search content, and manage file metadata.",
    category: "development",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-filesystem",
    },
    tags: ["files", "local", "filesystem"],
    author: "Anthropic",
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query and manage local SQLite databases.",
    longDescription: "SQLite MCP for local database operations. Run queries, manage schemas, import/export data, and handle migrations.",
    category: "databases",
    config: {
      type: "stdio",
      command: "npx -y @anthropic/mcp-server-sqlite",
    },
    tags: ["database", "sql", "local"],
    author: "Anthropic",
  },
];

// Helper functions
export function getServersByCategory(category: McpServerCategory): McpServerRegistryEntry[] {
  if (category === "featured") {
    return MCP_SERVER_REGISTRY.filter((s) => s.featured);
  }
  return MCP_SERVER_REGISTRY.filter((s) => s.category === category);
}

export function getFeaturedServers(): McpServerRegistryEntry[] {
  return MCP_SERVER_REGISTRY.filter((s) => s.featured);
}

export function searchServers(query: string): McpServerRegistryEntry[] {
  const q = query.toLowerCase();
  return MCP_SERVER_REGISTRY.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags?.some((t) => t.toLowerCase().includes(q))
  );
}

export function getServerById(id: string): McpServerRegistryEntry | undefined {
  return MCP_SERVER_REGISTRY.find((s) => s.id === id);
}
