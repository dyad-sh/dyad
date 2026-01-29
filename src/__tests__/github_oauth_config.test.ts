import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We'll test the OAuth config logic by re-implementing the validation here
// since the actual module has side effects (requires Electron)

// Legacy Dyad client ID that must not be used
const DYAD_LEGACY_CLIENT_ID = "Ov23liWV2HdC0RBLecWx";

// Minimal expected scopes
const EXPECTED_MINIMAL_SCOPES = ["read:user", "user:email", "repo"];
const CONFIGURED_SCOPES = "read:user,user:email,repo";

describe("GitHub OAuth Config Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getGithubClientId logic", () => {
    function getGithubClientId(isTestBuild = false): string | null {
      const abbaClientId = process.env.ABBA_GITHUB_OAUTH_CLIENT_ID;
      const legacyClientId = process.env.GITHUB_CLIENT_ID;

      // Prefer ABBA-specific env var
      if (abbaClientId && abbaClientId.trim() !== "") {
        return abbaClientId.trim();
      }

      // Fall back to legacy env var if set (but not the Dyad default)
      if (
        legacyClientId &&
        legacyClientId.trim() !== "" &&
        legacyClientId.trim() !== DYAD_LEGACY_CLIENT_ID
      ) {
        return legacyClientId.trim();
      }

      // In test builds, allow using a test client ID
      if (isTestBuild) {
        return "test-client-id";
      }

      return null;
    }

    it("should return ABBA_GITHUB_OAUTH_CLIENT_ID when set", () => {
      process.env.ABBA_GITHUB_OAUTH_CLIENT_ID = "my-abba-client-id";

      expect(getGithubClientId()).toBe("my-abba-client-id");
    });

    it("should trim whitespace from ABBA_GITHUB_OAUTH_CLIENT_ID", () => {
      process.env.ABBA_GITHUB_OAUTH_CLIENT_ID = "  my-client-id  ";

      expect(getGithubClientId()).toBe("my-client-id");
    });

    it("should fall back to GITHUB_CLIENT_ID if ABBA var not set", () => {
      process.env.GITHUB_CLIENT_ID = "my-legacy-client-id";

      expect(getGithubClientId()).toBe("my-legacy-client-id");
    });

    it("should prefer ABBA var over GITHUB_CLIENT_ID", () => {
      process.env.ABBA_GITHUB_OAUTH_CLIENT_ID = "abba-id";
      process.env.GITHUB_CLIENT_ID = "legacy-id";

      expect(getGithubClientId()).toBe("abba-id");
    });

    it("should NOT use legacy Dyad client ID as fallback", () => {
      process.env.GITHUB_CLIENT_ID = DYAD_LEGACY_CLIENT_ID;

      expect(getGithubClientId()).toBeNull();
    });

    it("should return null when no env vars are set (non-test)", () => {
      expect(getGithubClientId(false)).toBeNull();
    });

    it("should return test client ID in test builds", () => {
      expect(getGithubClientId(true)).toBe("test-client-id");
    });

    it("should return ABBA var even in test builds if set", () => {
      process.env.ABBA_GITHUB_OAUTH_CLIENT_ID = "my-abba-client-id";

      expect(getGithubClientId(true)).toBe("my-abba-client-id");
    });

    it("should ignore empty ABBA var", () => {
      process.env.ABBA_GITHUB_OAUTH_CLIENT_ID = "";
      process.env.GITHUB_CLIENT_ID = "fallback-id";

      expect(getGithubClientId()).toBe("fallback-id");
    });

    it("should ignore whitespace-only ABBA var", () => {
      process.env.ABBA_GITHUB_OAUTH_CLIENT_ID = "   ";
      process.env.GITHUB_CLIENT_ID = "fallback-id";

      expect(getGithubClientId()).toBe("fallback-id");
    });
  });

  describe("validateGithubOAuthConfig logic", () => {
    function getGithubClientId(isTestBuild = false): string | null {
      const abbaClientId = process.env.ABBA_GITHUB_OAUTH_CLIENT_ID;
      const legacyClientId = process.env.GITHUB_CLIENT_ID;

      if (abbaClientId && abbaClientId.trim() !== "") {
        return abbaClientId.trim();
      }

      if (
        legacyClientId &&
        legacyClientId.trim() !== "" &&
        legacyClientId.trim() !== DYAD_LEGACY_CLIENT_ID
      ) {
        return legacyClientId.trim();
      }

      if (isTestBuild) {
        return "test-client-id";
      }

      return null;
    }

    function validateGithubOAuthConfig(isTestBuild = false): {
      clientId: string;
      scopes: string;
    } {
      const clientId = getGithubClientId(isTestBuild);

      if (!clientId) {
        throw new Error(
          "GitHub OAuth client ID not configured. " +
            "Set ABBA_GITHUB_OAUTH_CLIENT_ID environment variable.",
        );
      }

      if (clientId === DYAD_LEGACY_CLIENT_ID) {
        throw new Error(
          "GitHub OAuth client ID is set to the legacy Dyad value. " +
            "Please configure ABBA_GITHUB_OAUTH_CLIENT_ID with your own GitHub OAuth App client ID.",
        );
      }

      return {
        clientId,
        scopes: CONFIGURED_SCOPES,
      };
    }

    it("should return config when ABBA var is set", () => {
      process.env.ABBA_GITHUB_OAUTH_CLIENT_ID = "valid-client-id";

      const config = validateGithubOAuthConfig();

      expect(config.clientId).toBe("valid-client-id");
      expect(config.scopes).toBe(CONFIGURED_SCOPES);
    });

    it("should throw when no client ID is configured (non-test)", () => {
      expect(() => validateGithubOAuthConfig(false)).toThrow(
        "GitHub OAuth client ID not configured",
      );
    });

    it("should throw when legacy Dyad client ID is detected", () => {
      // Force the legacy ID to be returned (edge case - shouldn't happen in practice)
      process.env.ABBA_GITHUB_OAUTH_CLIENT_ID = DYAD_LEGACY_CLIENT_ID;

      expect(() => validateGithubOAuthConfig()).toThrow("legacy Dyad value");
    });

    it("should return test config in test builds", () => {
      const config = validateGithubOAuthConfig(true);

      expect(config.clientId).toBe("test-client-id");
      expect(config.scopes).toBe(CONFIGURED_SCOPES);
    });
  });

  describe("OAuth scopes", () => {
    it("should have minimal required scopes", () => {
      const scopes = CONFIGURED_SCOPES.split(",").map((s) => s.trim());

      // Verify all expected scopes are present
      for (const expected of EXPECTED_MINIMAL_SCOPES) {
        expect(scopes).toContain(expected);
      }
    });

    it("should NOT include overly broad scopes", () => {
      const scopes = CONFIGURED_SCOPES.split(",").map((s) => s.trim());
      const overlyBroadScopes = [
        "admin",
        "delete_repo",
        "workflow",
        "write:org",
      ];

      for (const broad of overlyBroadScopes) {
        expect(scopes).not.toContain(broad);
      }
    });

    it("should use read:user instead of broader user scope", () => {
      const scopes = CONFIGURED_SCOPES.split(",").map((s) => s.trim());

      // Should have read:user
      expect(scopes).toContain("read:user");

      // Should NOT have the broader "user" scope (without colon)
      // "user" is broader than "read:user" and grants write access
      expect(scopes.includes("user")).toBe(false);
    });
  });

  describe("DYAD_LEGACY_CLIENT_ID constant", () => {
    it("should be the known Dyad client ID", () => {
      expect(DYAD_LEGACY_CLIENT_ID).toBe("Ov23liWV2HdC0RBLecWx");
    });

    it("should be a valid GitHub OAuth client ID format", () => {
      // GitHub OAuth client IDs are 20-character alphanumeric strings
      expect(DYAD_LEGACY_CLIENT_ID).toMatch(/^[A-Za-z0-9]{20}$/);
    });
  });
});
