import { describe, it, expect } from "vitest";
import {
  validateSupabaseUrl,
  validateSupabaseAnonKey,
  validateVaultConfig,
  maskKey,
  isVaultConfigured,
} from "../vault/vault_config";

describe("vault_config", () => {
  describe("validateSupabaseUrl", () => {
    it("should accept valid supabase.co URLs", () => {
      const result = validateSupabaseUrl(
        "https://shyspsgqbhiuntdjgfro.supabase.co",
      );
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept URLs with trailing slash", () => {
      const result = validateSupabaseUrl("https://myproject.supabase.co/");
      expect(result.isValid).toBe(true);
    });

    it("should accept custom domain URLs", () => {
      const result = validateSupabaseUrl("https://api.mycompany.com");
      expect(result.isValid).toBe(true);
    });

    it("should reject empty URLs", () => {
      const result = validateSupabaseUrl("");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("URL is required");
    });

    it("should reject whitespace-only URLs", () => {
      const result = validateSupabaseUrl("   ");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("URL is required");
    });

    it("should reject http:// URLs (non-secure)", () => {
      const result = validateSupabaseUrl("http://myproject.supabase.co");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("URL must use HTTPS");
    });

    it("should reject URLs without https://", () => {
      const result = validateSupabaseUrl("myproject.supabase.co");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("URL must start with https://");
    });

    it("should reject invalid URL formats", () => {
      const result = validateSupabaseUrl("https://not a valid url");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid Supabase URL format");
    });
  });

  describe("validateSupabaseAnonKey", () => {
    // Build a mock valid JWT key dynamically (3 parts with proper length)
    // These are fake test values, not real secrets
    const jwtHeader = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const jwtPayload =
      "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3Rwcm9qZWN0Iiwicm9sZSI6ImFub24ifQ";
    const jwtSignature = "X".repeat(43);
    const validJwtKey = `${jwtHeader}.${jwtPayload}.${jwtSignature}`;

    it("should accept valid JWT-format keys", () => {
      const result = validateSupabaseAnonKey(validJwtKey);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject empty keys", () => {
      const result = validateSupabaseAnonKey("");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Publishable key is required");
    });

    it("should reject whitespace-only keys", () => {
      const result = validateSupabaseAnonKey("   ");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Publishable key is required");
    });

    it("should reject keys that look like service role keys", () => {
      const result = validateSupabaseAnonKey("service_role_key_xxxx");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("service role key");
    });

    it("should reject keys with service-role pattern", () => {
      const result = validateSupabaseAnonKey("something_servicerole_else");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("service role key");
    });

    it("should reject keys without valid prefix", () => {
      const result = validateSupabaseAnonKey(
        "invalid_prefix_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid key format");
    });

    it("should reject malformed JWT (wrong number of parts)", () => {
      const result = validateSupabaseAnonKey(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.onlytwoptsXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid JWT format");
    });

    it("should reject keys that are too short", () => {
      const shortKey = "eyJhbGci.abc.def";
      const result = validateSupabaseAnonKey(shortKey);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("too short");
    });
  });

  describe("validateVaultConfig", () => {
    const validUrl = "https://myproject.supabase.co";
    // Build test key dynamically
    const jwtHeader = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const jwtPayload =
      "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3Rwcm9qZWN0Iiwicm9sZSI6ImFub24ifQ";
    const jwtSignature = "X".repeat(43);
    const validKey = `${jwtHeader}.${jwtPayload}.${jwtSignature}`;

    it("should accept valid URL and key", () => {
      const result = validateVaultConfig(validUrl, validKey);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should fail with invalid URL", () => {
      const result = validateVaultConfig("not-a-url", validKey);
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should fail with invalid key", () => {
      const result = validateVaultConfig(validUrl, "bad-key");
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should report URL error first when both are invalid", () => {
      const result = validateVaultConfig("", "");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("URL is required");
    });
  });

  describe("maskKey", () => {
    it("should mask keys showing only last 6 characters", () => {
      const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const masked = maskKey(key);
      // Last 6 chars of the key are "pXVCJ9"
      expect(masked).toBe("***...pXVCJ9");
    });

    it("should handle short keys", () => {
      const masked = maskKey("short");
      expect(masked).toBe("***");
    });

    it("should handle empty keys", () => {
      const masked = maskKey("");
      expect(masked).toBe("***");
    });

    it("should handle undefined/null keys", () => {
      // @ts-expect-error testing null handling
      expect(maskKey(null)).toBe("***");
      // @ts-expect-error testing undefined handling
      expect(maskKey(undefined)).toBe("***");
    });
  });

  describe("isVaultConfigured", () => {
    it("should return true when both URL and key are present", () => {
      const result = isVaultConfigured(
        "https://test.supabase.co",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.test",
      );
      expect(result).toBe(true);
    });

    it("should return false when URL is empty", () => {
      expect(isVaultConfigured("", "some-key")).toBe(false);
    });

    it("should return false when key is empty", () => {
      expect(isVaultConfigured("https://test.supabase.co", "")).toBe(false);
    });

    it("should return false when both are empty", () => {
      expect(isVaultConfigured("", "")).toBe(false);
    });

    it("should trim whitespace-only values as empty", () => {
      expect(isVaultConfigured("   ", "   ")).toBe(false);
      expect(isVaultConfigured("https://test.supabase.co", "   ")).toBe(false);
      expect(isVaultConfigured("   ", "some-key")).toBe(false);
    });
  });
});
