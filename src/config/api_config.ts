/**
 * JoyCreate API Configuration
 *
 * Central configuration for all JoyCreate API endpoints and branding.
 * All services now point to JoyCreate infrastructure.
 *
 * Legacy "dyad-" prefixed XML tags are still accepted for backward compatibility
 * with older AI-generated responses and existing user app codebases, but all new
 * output uses the "joy-" prefix.
 */

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// =============================================================================
// API ENDPOINTS
// =============================================================================

/**
 * Main API base URL
 */
export const API_BASE_URL = process.env.JOY_API_URL || "https://api.joycreate.app/v1";

/**
 * OAuth base URL for third-party integrations
 */
export const OAUTH_BASE_URL = process.env.JOY_OAUTH_URL || "https://oauth.joymarketplace.io/api";

/**
 * Supabase OAuth client ID (registered under JoyCreate/JoyMarketplace)
 */
export const SUPABASE_CLIENT_ID = process.env.SUPABASE_CLIENT_ID || "";

/**
 * GitHub OAuth client ID (registered under JoyCreate/JoyMarketplace)
 */
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";

/**
 * Supabase OAuth URLs
 */
export const SUPABASE_OAUTH_BASE_URL =
  process.env.JOY_SUPABASE_OAUTH_URL || "https://oauth.joymarketplace.io/api/supabase";

/**
 * AI Engine base URL
 */
export const ENGINE_BASE_URL = process.env.JOY_ENGINE_URL || "https://engine.joycreate.app/v1";

/**
 * Help/Support chat base URL
 */
export const HELP_CHAT_BASE_URL = process.env.JOY_HELP_URL || "https://help.joycreate.app/v1";

/**
 * Documentation base URL
 */
export const DOCS_BASE_URL = process.env.JOY_DOCS_URL || "https://docs.joycreate.app";

/**
 * Log upload service URL
 */
export const LOG_UPLOAD_URL =
  process.env.JOY_LOG_UPLOAD_URL || "https://upload-logs.joycreate.app/generate-upload-url";

// =============================================================================
// SPECIFIC ENDPOINTS
// =============================================================================

export const API_ENDPOINTS = {
  // Update service
  update: (postfix: string) => `${API_BASE_URL}/update/${postfix}`,

  // Templates
  templates: `${API_BASE_URL}/templates`,

  // User info
  userInfo: `${API_BASE_URL}/user/info`,

  // Supabase
  supabase: {
    login: `${SUPABASE_OAUTH_BASE_URL}/login`,
    refresh: `${SUPABASE_OAUTH_BASE_URL}/refresh`,
  },

  // Neon
  neon: {
    login: `${OAUTH_BASE_URL}/integrations/neon/login`,
    refresh: `${OAUTH_BASE_URL}/integrations/neon/refresh`,
  },

  // Engine
  engine: ENGINE_BASE_URL,

  // Help chat
  helpChat: HELP_CHAT_BASE_URL,

  // Log upload
  logUpload: LOG_UPLOAD_URL,
};

// =============================================================================
// GITHUB REPOSITORY
// =============================================================================

export const GITHUB_REPO = {
  owner: "DisciplesofLove",
  name: "JoyCreate",
  issuesUrl: "https://github.com/DisciplesofLove/JoyCreate/issues/new",
};

// =============================================================================
// DOCUMENTATION LINKS
// =============================================================================

export const DOCS_LINKS = {
  home: DOCS_BASE_URL,

  // Policies
  privacy: `${DOCS_BASE_URL}/policies/privacy-policy`,

  // Integrations
  github: `${DOCS_BASE_URL}/integrations/github`,
  githubTroubleshooting: `${DOCS_BASE_URL}/integrations/github#troubleshooting`,
  supabase: `${DOCS_BASE_URL}/integrations/supabase`,
  supabaseNoKeys: `${DOCS_BASE_URL}/integrations/supabase#no-publishable-keys`,

  // Guides
  securityReview: `${DOCS_BASE_URL}/guides/security-review`,
  mobileApp: `${DOCS_BASE_URL}/guides/mobile-app`,
  mobileAppUpgrade: `${DOCS_BASE_URL}/guides/mobile-app#upgrade-your-app`,

  // Upgrades
  selectComponent: `${DOCS_BASE_URL}/upgrades/select-component`,

  // Templates
  portalMigration: `${DOCS_BASE_URL}/templates/portal#create-a-database-migration`,

  // Releases
  release: (version: string) => `${DOCS_BASE_URL}/releases/${version}`,
};

// =============================================================================
// BRANDING
// =============================================================================

export const BRANDING = {
  appName: "Create",
  appNameLowercase: "create",
  tagPrefix: "joy",
  domain: "joycreate.app",
};

// =============================================================================
// BACKWARD COMPATIBILITY
// =============================================================================

/**
 * Support both old (dyad-) and new (joy-) tag formats.
 * Old tags are still parsed for backward compatibility with existing
 * AI-generated code and user app codebases.
 */
export const SUPPORTED_TAG_PREFIXES = ["joy", "dyad"];

/**
 * Check if a tag uses either the old or new format
 */
export function isValidTag(tagName: string): boolean {
  return SUPPORTED_TAG_PREFIXES.some(
    (prefix) =>
      tagName.startsWith(`${prefix}-`) || tagName.startsWith(`<${prefix}-`),
  );
}

/**
 * Normalize tag name to current format (joy-)
 */
export function normalizeTagName(tagName: string): string {
  return tagName.replace(/dyad-/g, "joy-");
}

/**
 * Get the current tag prefix
 */
export function getTagPrefix(): string {
  return BRANDING.tagPrefix;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get API endpoint URL with fallback
 */
export async function getApiEndpoint(
  endpoint: string,
  fallback?: string,
): Promise<string> {
  try {
    const response = await fetch(endpoint, { method: "HEAD" });
    if (response.ok) return endpoint;
  } catch {
    // Fall through to fallback
  }

  return fallback || endpoint;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  API_BASE_URL,
  OAUTH_BASE_URL,
  SUPABASE_CLIENT_ID,
  GITHUB_CLIENT_ID,
  SUPABASE_OAUTH_BASE_URL,
  ENGINE_BASE_URL,
  HELP_CHAT_BASE_URL,
  DOCS_BASE_URL,
  LOG_UPLOAD_URL,
  API_ENDPOINTS,
  GITHUB_REPO,
  DOCS_LINKS,
  BRANDING,
  SUPPORTED_TAG_PREFIXES,
  isValidTag,
  normalizeTagName,
  getTagPrefix,
  getApiEndpoint,
};
