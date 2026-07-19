const ALLOWED_TECHNICAL_TEXT = new Set([
  "Agent",
  "Agent v2",
  "AI",
  "API",
  "Anthropic",
  "Apps",
  "DB",
  "Docker",
  "Dyad",
  "Google",
  "GitHub",
  "GREP",
  "HTTP",
  "LM Studio",
  "MCP",
  "MCP Tools",
  "Neon",
  "Node.js",
  "Ollama",
  "Pro",
  "SQL",
  "Supabase",
  "URL",
  "Vercel",
  "Web Search",
  "OpenAI",
  "http",
  "node_modules/**/*",
  "pnpm dev",
  "pnpm install",
  "src/**/*.config.ts",
  "src/**/*.tsx",
  "stdio",
]);

export function isAllowedEnglishText(value: string): boolean {
  const normalized = value.trim();
  if (ALLOWED_TECHNICAL_TEXT.has(normalized)) return true;

  // These values are identifiers or technical literals, not English UI copy.
  // Keep the patterns narrow so a sentence cannot be silenced accidentally.
  return (
    /^(?:https?|wss?|file):\/\/\S+$/i.test(normalized) ||
    /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(normalized) ||
    (/^[\w./\\:@-]+$/.test(normalized) && /[0-9_./\\:@]/.test(normalized))
  );
}

export function allowedEnglishText(): ReadonlySet<string> {
  return ALLOWED_TECHNICAL_TEXT;
}
