/**
 * Vault Configuration Validation Utilities
 * Validates Supabase URL format and publishable key format
 */

export interface VaultConfigValidation {
  isValid: boolean;
  error?: string;
}

/**
 * Valid Supabase URL patterns:
 * - https://<project-ref>.supabase.co
 * - https://<custom-domain>
 */
const SUPABASE_URL_PATTERN =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$|^https:\/\/[a-z0-9.-]+\/?$/i;

/**
 * Valid Supabase key prefixes:
 * - eyJ... (legacy JWT format - anon key)
 * - sbp_ (new publishable key format, if adopted)
 */
const VALID_KEY_PREFIXES = ["eyJ"];

/**
 * Forbidden key prefixes (service role keys - NEVER use in client):
 * - service_role patterns
 */
const FORBIDDEN_KEY_PATTERNS = [
  /service.?role/i,
  /^sbp_service/i, // hypothetical service key prefix
];

/**
 * Validate Supabase project URL format
 */
export function validateSupabaseUrl(url: string): VaultConfigValidation {
  if (!url || url.trim() === "") {
    return { isValid: false, error: "URL is required" };
  }

  const trimmedUrl = url.trim();

  // Check for http (not https)
  if (trimmedUrl.startsWith("http://")) {
    return { isValid: false, error: "URL must use HTTPS" };
  }

  // Check for https
  if (!trimmedUrl.startsWith("https://")) {
    return { isValid: false, error: "URL must start with https://" };
  }

  // Check URL format
  if (!SUPABASE_URL_PATTERN.test(trimmedUrl)) {
    return {
      isValid: false,
      error:
        "Invalid Supabase URL format. Expected: https://<project>.supabase.co",
    };
  }

  return { isValid: true };
}

/**
 * Validate Supabase publishable/anon key format
 * IMPORTANT: This validates format only - never validates against service role keys
 */
export function validateSupabaseAnonKey(key: string): VaultConfigValidation {
  if (!key || key.trim() === "") {
    return { isValid: false, error: "Publishable key is required" };
  }

  const trimmedKey = key.trim();

  // Check for forbidden patterns (service role keys)
  for (const pattern of FORBIDDEN_KEY_PATTERNS) {
    if (pattern.test(trimmedKey)) {
      return {
        isValid: false,
        error:
          "This looks like a service role key. Use the publishable/anon key instead.",
      };
    }
  }

  // Check for valid prefixes
  const hasValidPrefix = VALID_KEY_PREFIXES.some((prefix) =>
    trimmedKey.startsWith(prefix),
  );

  if (!hasValidPrefix) {
    return {
      isValid: false,
      error:
        "Invalid key format. Supabase anon keys typically start with 'eyJ...'",
    };
  }

  // Basic JWT structure check (3 parts separated by dots)
  if (trimmedKey.startsWith("eyJ")) {
    const parts = trimmedKey.split(".");
    if (parts.length !== 3) {
      return {
        isValid: false,
        error: "Invalid JWT format. Key should have 3 parts separated by dots.",
      };
    }
  }

  // Minimum length check
  if (trimmedKey.length < 100) {
    return {
      isValid: false,
      error: "Key appears too short. Check that you copied the full key.",
    };
  }

  return { isValid: true };
}

/**
 * Validate complete vault configuration
 */
export function validateVaultConfig(
  url: string,
  anonKey: string,
): VaultConfigValidation {
  const urlValidation = validateSupabaseUrl(url);
  if (!urlValidation.isValid) {
    return urlValidation;
  }

  const keyValidation = validateSupabaseAnonKey(anonKey);
  if (!keyValidation.isValid) {
    return keyValidation;
  }

  return { isValid: true };
}

/**
 * Mask a key for safe logging/display
 * Shows only last 6 characters
 */
export function maskKey(key: string): string {
  if (!key || key.length < 10) {
    return "***";
  }
  return `***...${key.slice(-6)}`;
}

/**
 * Default Vault configuration from environment.
 * These values are injected at build time via GitHub Actions secrets.
 *
 * Env var names:
 * - ABBA_VAULT_SUPABASE_URL: The Supabase project URL
 * - ABBA_VAULT_SUPABASE_ANON_KEY: The Supabase anon/public key (safe for client)
 *
 * Fallbacks for backwards compatibility:
 * - VAULT_SUPABASE_URL
 * - VAULT_SUPABASE_ANON_KEY
 */
export const DEFAULT_VAULT_URL =
  process.env.ABBA_VAULT_SUPABASE_URL ||
  process.env.VAULT_SUPABASE_URL ||
  "https://shyspsgqbhiuntdjgfro.supabase.co";
export const DEFAULT_VAULT_ANON_KEY =
  process.env.ABBA_VAULT_SUPABASE_ANON_KEY ||
  process.env.VAULT_SUPABASE_ANON_KEY ||
  "";

/**
 * Check if we have valid default configuration from environment.
 * Used for zero-config auto-population.
 */
export function hasEnvDefaults(): boolean {
  return !!DEFAULT_VAULT_URL && !!DEFAULT_VAULT_ANON_KEY;
}

/**
 * Check if the Vault is fully configured (URL and key present).
 */
export function isVaultConfigured(url: string, anonKey: string): boolean {
  return (
    !!url && url.trim().length > 0 && !!anonKey && anonKey.trim().length > 0
  );
}
