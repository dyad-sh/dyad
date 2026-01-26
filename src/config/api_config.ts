/**
 * JoyCreate API Configuration
 * 
 * Central configuration for all JoyCreate API endpoints.
 * Supports gradual migration from Dyad infrastructure to JoyCreate infrastructure.
 */

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const USE_JOYCREATE_INFRASTRUCTURE = process.env.USE_JOYCREATE_INFRA === "true";

// =============================================================================
// API ENDPOINTS
// =============================================================================

/**
 * Main API base URL
 */
export const API_BASE_URL = USE_JOYCREATE_INFRASTRUCTURE
  ? "https://api.joycreate.app/v1"
  : "https://api.dyad.sh/v1"; // Fallback during transition

/**
 * OAuth base URL for third-party integrations
 */
export const OAUTH_BASE_URL = USE_JOYCREATE_INFRASTRUCTURE
  ? "https://oauth.joycreate.app/api"
  : "https://oauth.dyad.sh/api";

/**
 * Supabase OAuth URLs
 */
export const SUPABASE_OAUTH_BASE_URL = USE_JOYCREATE_INFRASTRUCTURE
  ? "https://oauth.joycreate.app/api/supabase"
  : "https://supabase-oauth.dyad.sh/api/connect-supabase";

/**
 * AI Engine base URL
 */
export const ENGINE_BASE_URL = USE_JOYCREATE_INFRASTRUCTURE
  ? "https://engine.joycreate.app/v1"
  : "https://engine.dyad.sh/v1";

/**
 * Help/Support chat base URL
 */
export const HELP_CHAT_BASE_URL = USE_JOYCREATE_INFRASTRUCTURE
  ? "https://help.joycreate.app/v1"
  : "https://helpchat.dyad.sh/v1";

/**
 * Documentation base URL
 */
export const DOCS_BASE_URL = USE_JOYCREATE_INFRASTRUCTURE
  ? "https://docs.joycreate.app"
  : "https://www.dyad.sh/docs";

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
  appName: "JoyCreate",
  appNameLowercase: "joycreate",
  tagPrefix: USE_JOYCREATE_INFRASTRUCTURE ? "joy" : "dyad", // Support both during transition
  domain: USE_JOYCREATE_INFRASTRUCTURE ? "joycreate.app" : "dyad.sh",
};

// =============================================================================
// BACKWARD COMPATIBILITY
// =============================================================================

/**
 * Support both old and new tag formats during transition
 */
export const SUPPORTED_TAG_PREFIXES = ["joy", "dyad"];

/**
 * Map old Dyad settings to new JoyCreate settings
 */
export const SETTINGS_MIGRATION_MAP = {
  enableDyadPro: "enableJoyPro",
  dyadProBudget: "joyBudget",
  // Add more mappings as needed
};

/**
 * Check if a tag uses either the old or new format
 */
export function isValidTag(tagName: string): boolean {
  return SUPPORTED_TAG_PREFIXES.some(prefix => 
    tagName.startsWith(`${prefix}-`) || tagName.startsWith(`<${prefix}-`)
  );
}

/**
 * Normalize tag name to current format
 */
export function normalizeTagName(tagName: string): string {
  // Replace old "dyad-" prefix with new "joy-" prefix
  return tagName.replace(/dyad-/g, `${BRANDING.tagPrefix}-`);
}

/**
 * Get the current tag prefix (supports migration)
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
  fallback?: string
): Promise<string> {
  // Try JoyCreate endpoint first if configured
  if (USE_JOYCREATE_INFRASTRUCTURE) {
    try {
      const response = await fetch(endpoint, { method: "HEAD" });
      if (response.ok) return endpoint;
    } catch {
      // Fall through to fallback
    }
  }
  
  // Use fallback or original endpoint
  return fallback || endpoint;
}

/**
 * Migration helper: Convert old Dyad URLs to JoyCreate URLs
 */
export function migrateUrl(url: string): string {
  if (!USE_JOYCREATE_INFRASTRUCTURE) {
    return url; // No migration during transition
  }
  
  return url
    .replace(/dyad\.sh/g, "joycreate.app")
    .replace(/dyadpro\.com/g, "joycreate.app")
    .replace(/supabase-oauth\.dyad\.sh/g, "oauth.joycreate.app")
    .replace(/oauth\.dyad\.sh/g, "oauth.joycreate.app")
    .replace(/engine\.dyad\.sh/g, "engine.joycreate.app")
    .replace(/helpchat\.dyad\.sh/g, "help.joycreate.app")
    .replace(/api\.dyad\.sh/g, "api.joycreate.app");
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  API_BASE_URL,
  OAUTH_BASE_URL,
  SUPABASE_OAUTH_BASE_URL,
  ENGINE_BASE_URL,
  HELP_CHAT_BASE_URL,
  DOCS_BASE_URL,
  API_ENDPOINTS,
  DOCS_LINKS,
  BRANDING,
  SUPPORTED_TAG_PREFIXES,
  SETTINGS_MIGRATION_MAP,
  isValidTag,
  normalizeTagName,
  getTagPrefix,
  getApiEndpoint,
  migrateUrl,
};
