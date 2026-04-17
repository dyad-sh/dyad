/**
 * Voice Command Engine
 *
 * Shared intent detection and action routing for voice commands.
 * Used by the in-app VoiceCommandOverlay, Telegram bot, and Discord bot.
 */

// ── Intent Types ────────────────────────────────────────────────────────────

export type VoiceIntent =
  | "build_app"
  | "create_workflow"
  | "create_agent"
  | "manage_email"
  | "manage_marketing"
  | "generate_image"
  | "generate_video"
  | "deploy"
  | "navigate"
  | "search"
  | "run_app"
  | "stop_app"
  | "system"
  | "autonomous_task"
  | "create_skill"
  | "chat";

export interface VoiceCommandResult {
  intent: VoiceIntent;
  confidence: number;
  entities: Record<string, string>;
  rawText: string;
  description: string;
  /** Route to navigate to, if applicable */
  route?: string;
}

// ── Route Map ───────────────────────────────────────────────────────────────

const NAVIGATION_ROUTES: Record<string, string> = {
  home: "/",
  hub: "/hub",
  chat: "/chat",
  settings: "/settings",
  agents: "/agents",
  agent_swarm: "/agent-swarm",
  agent_orchestrator: "/agent-orchestrator",
  autonomous: "/autonomous-agent",
  cns: "/cns",
  openclaw: "/openclaw-control",
  kanban: "/openclaw-kanban",
  neural_builder: "/neural-builder",
  coding_agent: "/coding-agent",
  cicd: "/cicd-builder",
  workflows: "/workflows",
  documents: "/documents",
  library: "/library",
  marketplace: "/marketplace",
  plugin_marketplace: "/plugin-marketplace",
  nft_marketplace: "/nft-marketplace",
  model_registry: "/model-registry",
  model_download: "/model-download",
  local_models: "/local-models",
  vault: "/local-vault",
  secrets: "/secrets-vault",
  data_sovereignty: "/data-sovereignty",
  datasets: "/datasets",
  asset_studio: "/asset-studio",
  benchmark: "/benchmark",
  deploy: "/deploy",
  decentralized_deploy: "/decentralized-deploy",
  decentralized_chat: "/decentralized-chat",
  compute: "/compute",
  calendar: "/calendar",
  email: "/email-hub",
  integrations: "/integrations",
  memory: "/memory",
  ai_learning: "/ai-learning",
  design_system: "/design-system",
  creator: "/creator",
  creator_network: "/creator-network",
  mcp: "/mcp-hub",
  offline_docs: "/offline-docs",
  system_services: "/system-services",
  skills: "/skills",
};

// ── Intent Detection ────────────────────────────────────────────────────────

const PATTERNS: Array<{ pattern: RegExp; intent: VoiceIntent; description: string; routeKey?: string }> = [
  // ── App Creation ──────────────────────────────────────────────────────
  {
    pattern: /\b(build|create|make|scaffold|start|generate|develop)\b[\w\s,]{0,60}\b(app|application|website|web app|site|project|page|landing page|dashboard|platform|tool|software|program)\b/i,
    intent: "build_app",
    description: "Building an app",
  },
  {
    pattern: /\b(build|create|make)\s+(me|us)\s+(an?\s+)?(app|application|website|site|project|dashboard|platform|tool|software|program)\b/i,
    intent: "build_app",
    description: "Building an app",
  },

  // ── Workflow / Automation ─────────────────────────────────────────────
  {
    pattern: /\b(create|build|make|setup|configure|add)\b[\w\s,]{0,40}\b(workflow|automation|pipeline|n8n|zap|integration flow)\b/i,
    intent: "create_workflow",
    description: "Creating a workflow",
  },

  // ── Agent Creation ────────────────────────────────────────────────────
  {
    pattern: /\b(create|build|make|setup|configure|add|train)\b[\w\s,]{0,40}\b(agent|bot|assistant|ai agent|autonomous agent)\b/i,
    intent: "create_agent",
    description: "Creating an agent",
  },

  // ── Email Management ──────────────────────────────────────────────────
  {
    pattern: /\b(manage|handle|take care of|organize|check|read|send|reply|respond to|sort|filter)\b[\w\s,]{0,40}\b(email|emails|inbox|mail|correspondence|messages|clients?)\b/i,
    intent: "manage_email",
    description: "Managing emails",
  },
  {
    pattern: /\b(email|inbox)\s+(management|automation|handling)\b/i,
    intent: "manage_email",
    description: "Managing emails",
  },

  // ── Marketing ─────────────────────────────────────────────────────────
  {
    pattern: /\b(manage|handle|run|automate|setup|configure|do|take care of)\b[\w\s,]{0,60}\b(marketing|social media|ads|advertising|campaign|content marketing|seo|growth|promotion|branding)\b/i,
    intent: "manage_marketing",
    description: "Managing marketing",
  },
  {
    pattern: /\b(marketing|social media|advertising|campaign)\s+(management|automation|strategy)\b/i,
    intent: "manage_marketing",
    description: "Managing marketing",
  },

  // ── Image Generation ──────────────────────────────────────────────────
  {
    pattern: /\b(generate|create|make|draw|paint|design|render|illustrate|sketch)\b[\w\s,]{0,40}\b(image|picture|photo|artwork|illustration|icon|logo|graphic|banner|poster|thumbnail)\b/i,
    intent: "generate_image",
    description: "Generating an image",
  },

  // ── Video Generation ──────────────────────────────────────────────────
  {
    pattern: /\b(generate|create|make|render|animate|produce|film)\b[\w\s,]{0,40}\b(video|animation|clip|gif|movie|motion|reel)\b/i,
    intent: "generate_video",
    description: "Generating a video",
  },

  // ── Deployment ────────────────────────────────────────────────────────
  {
    pattern: /\b(deploy|publish|push|launch|ship)\b[\w\s,]{0,40}\b(to\s+)?(github|vercel|ipfs|arweave|fleek|netlify|production|decentralized|blockchain)\b/i,
    intent: "deploy",
    description: "Deploying",
  },
  {
    pattern: /\b(deploy|publish|launch|ship)\s+(my\s+)?(app|project|site|website)\b/i,
    intent: "deploy",
    description: "Deploying your app",
  },

  // ── Run / Stop App ────────────────────────────────────────────────────
  {
    pattern: /\b(run|start|launch|execute|preview)\s+(the\s+)?(app|application|project|preview)\b/i,
    intent: "run_app",
    description: "Running the app",
  },
  {
    pattern: /\b(stop|kill|close|terminate|shutdown)\s+(the\s+)?(app|application|project|preview|server)\b/i,
    intent: "stop_app",
    description: "Stopping the app",
  },

  // ── Search ────────────────────────────────────────────────────────────
  {
    pattern: /\b(search|find|look for|locate|browse)\s+(for\s+)?/i,
    intent: "search",
    description: "Searching",
  },

  // ── Navigation ────────────────────────────────────────────────────────
  {
    pattern: /\b(go to|open|navigate to|take me to|show me|switch to|visit)\s+(the\s+)?/i,
    intent: "navigate",
    description: "Navigating",
  },

  // ── System Commands ───────────────────────────────────────────────────
  {
    pattern: /\b(restart|reload|refresh|update|check|status|debug|diagnostics)\s+(the\s+)?(app|joy|joycreate|system|services?)\b/i,
    intent: "system",
    description: "System command",
  },

  // ── Skill Creation ────────────────────────────────────────────────────
  {
    pattern: /\b(create|build|make|add|teach|learn|generate)\b[\w\s,]{0,40}\b(skill|ability|capability)\b/i,
    intent: "create_skill",
    description: "Creating a skill",
  },
  {
    pattern: /\bteach\s+(me|the bot|the agent|my bot|my agent)\b/i,
    intent: "create_skill",
    description: "Teaching the bot a skill",
  },
];

// Navigation keyword → route mapping for natural language
const NAV_KEYWORDS: Array<{ keywords: RegExp; routeKey: string }> = [
  { keywords: /\bhome\b|^go home$/i, routeKey: "home" },
  { keywords: /\bhub\b/i, routeKey: "hub" },
  { keywords: /\bchat\b/i, routeKey: "chat" },
  { keywords: /\bsettings?\b|preferences?\b|config/i, routeKey: "settings" },
  { keywords: /\bagents?\b(?!.*swarm)(?!.*orchestrat)/i, routeKey: "agents" },
  { keywords: /\bagent\s*swarm/i, routeKey: "agent_swarm" },
  { keywords: /\borchestrat/i, routeKey: "agent_orchestrator" },
  { keywords: /\bautonomous/i, routeKey: "autonomous" },
  { keywords: /\bcns\b|central nervous/i, routeKey: "cns" },
  { keywords: /\bopenclaw\b(?!.*kanban)/i, routeKey: "openclaw" },
  { keywords: /\bkanban/i, routeKey: "kanban" },
  { keywords: /\bneural\s*builder/i, routeKey: "neural_builder" },
  { keywords: /\bcoding\s*agent/i, routeKey: "coding_agent" },
  { keywords: /\bci\/?cd/i, routeKey: "cicd" },
  { keywords: /\bworkflow/i, routeKey: "workflows" },
  { keywords: /\bdocuments?\b/i, routeKey: "documents" },
  { keywords: /\blibrary/i, routeKey: "library" },
  { keywords: /\bmarketplace\b(?!.*plugin)(?!.*nft)/i, routeKey: "marketplace" },
  { keywords: /\bplugin\s*marketplace/i, routeKey: "plugin_marketplace" },
  { keywords: /\bnft\s*marketplace/i, routeKey: "nft_marketplace" },
  { keywords: /\bmodel\s*registry/i, routeKey: "model_registry" },
  { keywords: /\bmodel\s*download/i, routeKey: "model_download" },
  { keywords: /\blocal\s*models?\b/i, routeKey: "local_models" },
  { keywords: /\bvault\b(?!.*secret)/i, routeKey: "vault" },
  { keywords: /\bsecrets?\s*vault/i, routeKey: "secrets" },
  { keywords: /\bdata\s*sovereignty/i, routeKey: "data_sovereignty" },
  { keywords: /\bdatasets?\b/i, routeKey: "datasets" },
  { keywords: /\basset\s*studio/i, routeKey: "asset_studio" },
  { keywords: /\bbenchmark/i, routeKey: "benchmark" },
  { keywords: /\bdeploy\b(?!.*decentral)/i, routeKey: "deploy" },
  { keywords: /\bdecentralized?\s*deploy/i, routeKey: "decentralized_deploy" },
  { keywords: /\bdecentralized?\s*chat/i, routeKey: "decentralized_chat" },
  { keywords: /\bcompute\b/i, routeKey: "compute" },
  { keywords: /\bcalendar/i, routeKey: "calendar" },
  { keywords: /\bemail\b|inbox/i, routeKey: "email" },
  { keywords: /\bintegrations?\b/i, routeKey: "integrations" },
  { keywords: /\bmemory\b/i, routeKey: "memory" },
  { keywords: /\bai\s*learning/i, routeKey: "ai_learning" },
  { keywords: /\bdesign\s*system/i, routeKey: "design_system" },
  { keywords: /\bcreator\b(?!.*network)/i, routeKey: "creator" },
  { keywords: /\bcreator\s*network/i, routeKey: "creator_network" },
  { keywords: /\bmcp\b/i, routeKey: "mcp" },
  { keywords: /\boffline\s*docs/i, routeKey: "offline_docs" },
  { keywords: /\bsystem\s*services/i, routeKey: "system_services" },
  { keywords: /\bskills?\b/i, routeKey: "skills" },
];

/**
 * Detect the intent from a voice transcription or text input.
 * Returns structured result with intent, confidence, entities and routing info.
 */
export function detectVoiceIntent(text: string): VoiceCommandResult {
  const t = text.trim();
  if (!t) {
    return {
      intent: "chat",
      confidence: 0,
      entities: {},
      rawText: t,
      description: "Empty input",
    };
  }

  // Try each pattern in priority order
  for (const { pattern, intent, description } of PATTERNS) {
    if (pattern.test(t)) {
      const result: VoiceCommandResult = {
        intent,
        confidence: 0.85,
        entities: extractEntities(t, intent),
        rawText: t,
        description,
      };

      // For navigation intent, resolve the target route
      if (intent === "navigate") {
        const route = resolveNavigationRoute(t);
        if (route) {
          result.route = route;
          result.description = `Navigating to ${route}`;
          result.confidence = 0.9;
        }
      }

      // For email management, set the route to email hub
      if (intent === "manage_email") {
        result.route = "/email-hub";
      }

      return result;
    }
  }

  // Check if it's a pure navigation request we missed
  const navRoute = resolveNavigationRoute(t);
  if (navRoute) {
    return {
      intent: "navigate",
      confidence: 0.8,
      entities: { target: navRoute },
      rawText: t,
      description: `Navigating to ${navRoute}`,
      route: navRoute,
    };
  }

  // Check if it sounds like an actionable task (autonomous)
  if (isAutonomousTask(t)) {
    return {
      intent: "autonomous_task",
      confidence: 0.7,
      entities: {},
      rawText: t,
      description: "Executing task",
    };
  }

  // Default to chat
  return {
    intent: "chat",
    confidence: 0.5,
    entities: {},
    rawText: t,
    description: "Chat message",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveNavigationRoute(text: string): string | null {
  for (const { keywords, routeKey } of NAV_KEYWORDS) {
    if (keywords.test(text)) {
      return NAVIGATION_ROUTES[routeKey] || null;
    }
  }
  return null;
}

function extractEntities(text: string, intent: VoiceIntent): Record<string, string> {
  const entities: Record<string, string> = {};

  switch (intent) {
    case "build_app": {
      // Try to extract what kind of app — everything after "build/create/make ... app for"
      const forMatch = text.match(/\bfor\s+(.+?)(?:\.|$)/i);
      if (forMatch) entities.purpose = forMatch[1].trim();
      // Or the description before "app"
      const descMatch = text.match(/\b(?:build|create|make)\s+(?:me\s+)?(?:an?\s+)?(.+?)\s+(?:app|application|website|site)/i);
      if (descMatch) entities.description = descMatch[1].trim();
      break;
    }
    case "create_workflow": {
      const wfMatch = text.match(/\b(?:workflow|automation)\s+(?:for|to|that)\s+(.+?)(?:\.|$)/i);
      if (wfMatch) entities.purpose = wfMatch[1].trim();
      break;
    }
    case "deploy": {
      const targetMatch = text.match(/\bto\s+(github|vercel|ipfs|arweave|fleek|netlify|production|decentralized)/i);
      if (targetMatch) entities.target = targetMatch[1].toLowerCase();
      break;
    }
    case "generate_image":
    case "generate_video": {
      // Everything after "generate/create/make ... image/video of"
      const ofMatch = text.match(/\b(?:of|showing|with|about)\s+(.+?)(?:\.|$)/i);
      if (ofMatch) entities.prompt = ofMatch[1].trim();
      break;
    }
    case "navigate": {
      const route = resolveNavigationRoute(text);
      if (route) entities.target = route;
      break;
    }
    default:
      break;
  }

  return entities;
}

function isAutonomousTask(text: string): boolean {
  // Phrases that imply the user wants something DONE, not just discussed
  const actionIndicators = /\b(can you|please|i want|i need|help me|set up|take care|handle|manage|automate|configure|install|connect|fix|update|organize|schedule|do)\b/i;
  // Must be longer than a simple question
  return actionIndicators.test(text) && text.split(/\s+/).length > 3;
}

/**
 * Get a human-readable action label for a voice command intent
 */
export function getIntentLabel(intent: VoiceIntent): string {
  const labels: Record<VoiceIntent, string> = {
    build_app: "Building App",
    create_workflow: "Creating Workflow",
    create_agent: "Creating Agent",
    manage_email: "Managing Emails",
    manage_marketing: "Managing Marketing",
    generate_image: "Generating Image",
    generate_video: "Generating Video",
    deploy: "Deploying",
    navigate: "Navigating",
    search: "Searching",
    run_app: "Running App",
    stop_app: "Stopping App",
    system: "System Command",
    autonomous_task: "Executing Task",
    create_skill: "Creating Skill",
    chat: "Chatting",
  };
  return labels[intent];
}

/**
 * Get an icon name for a voice command intent (lucide icon names)
 */
export function getIntentIcon(intent: VoiceIntent): string {
  const icons: Record<VoiceIntent, string> = {
    build_app: "Hammer",
    create_workflow: "GitBranch",
    create_agent: "Bot",
    manage_email: "Mail",
    manage_marketing: "Megaphone",
    generate_image: "Image",
    generate_video: "Video",
    deploy: "Rocket",
    navigate: "Navigation",
    search: "Search",
    run_app: "Play",
    stop_app: "Square",
    system: "Settings",
    autonomous_task: "Zap",
    create_skill: "Sparkles",
    chat: "MessageCircle",
  };
  return icons[intent];
}
