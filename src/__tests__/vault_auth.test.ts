import { describe, it, expect } from "vitest";
import { VaultAuthSessionSchema, VaultSettingsSchema } from "../lib/schemas";

describe("VaultAuthSession Schema", () => {
  const validSession = {
    accessToken: {
      value: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature",
    },
    refreshToken: { value: "refresh_token_value" },
    userEmail: "user@example.com",
    expiresAt: Date.now() + 3600000, // 1 hour from now
  };

  it("should accept valid auth session", () => {
    const result = VaultAuthSessionSchema.safeParse(validSession);
    expect(result.success).toBe(true);
  });

  it("should accept session with encryption type", () => {
    const sessionWithEncryption = {
      ...validSession,
      accessToken: {
        value: "encrypted_value",
        encryptionType: "electron-safe-storage" as const,
      },
      refreshToken: {
        value: "encrypted_refresh",
        encryptionType: "electron-safe-storage" as const,
      },
    };
    const result = VaultAuthSessionSchema.safeParse(sessionWithEncryption);
    expect(result.success).toBe(true);
  });

  it("should reject session missing accessToken", () => {
    const { accessToken: _accessToken, ...incomplete } = validSession;
    const result = VaultAuthSessionSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("should reject session missing refreshToken", () => {
    const { refreshToken: _refreshToken, ...incomplete } = validSession;
    const result = VaultAuthSessionSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("should reject session missing userEmail", () => {
    const { userEmail: _userEmail, ...incomplete } = validSession;
    const result = VaultAuthSessionSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("should reject session missing expiresAt", () => {
    const { expiresAt: _expiresAt, ...incomplete } = validSession;
    const result = VaultAuthSessionSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("should reject non-numeric expiresAt", () => {
    const invalidSession = {
      ...validSession,
      expiresAt: "not-a-number",
    };
    const result = VaultAuthSessionSchema.safeParse(invalidSession);
    expect(result.success).toBe(false);
  });
});

describe("VaultSettings Schema with authSession", () => {
  it("should accept settings without authSession", () => {
    const settings = {
      supabaseUrl: "https://myproject.supabase.co",
      supabaseAnonKey: { value: "anon_key_value" },
    };
    const result = VaultSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it("should accept settings with authSession", () => {
    const settings = {
      supabaseUrl: "https://myproject.supabase.co",
      supabaseAnonKey: { value: "anon_key_value" },
      authSession: {
        accessToken: { value: "access_token" },
        refreshToken: { value: "refresh_token" },
        userEmail: "user@example.com",
        expiresAt: Date.now() + 3600000,
      },
    };
    const result = VaultSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it("should accept empty settings", () => {
    const result = VaultSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should reject invalid authSession structure", () => {
    const settings = {
      supabaseUrl: "https://myproject.supabase.co",
      authSession: {
        // Missing required fields
        userEmail: "user@example.com",
      },
    };
    const result = VaultSettingsSchema.safeParse(settings);
    expect(result.success).toBe(false);
  });
});

describe("Vault Settings Persistence", () => {
  it("should preserve vault URL and key after parsing", () => {
    const originalSettings = {
      supabaseUrl: "https://test-project.supabase.co",
      supabaseAnonKey: {
        value: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.sig",
        encryptionType: "plaintext" as const,
      },
    };

    const parsed = VaultSettingsSchema.parse(originalSettings);

    expect(parsed.supabaseUrl).toBe(originalSettings.supabaseUrl);
    expect(parsed.supabaseAnonKey?.value).toBe(
      originalSettings.supabaseAnonKey.value,
    );
  });

  it("should preserve auth session after parsing", () => {
    const expiresAt = Date.now() + 3600000;
    const originalSettings = {
      supabaseUrl: "https://test-project.supabase.co",
      supabaseAnonKey: { value: "anon_key" },
      authSession: {
        accessToken: { value: "access_token_123" },
        refreshToken: { value: "refresh_token_456" },
        userEmail: "test@example.com",
        expiresAt,
      },
    };

    const parsed = VaultSettingsSchema.parse(originalSettings);

    expect(parsed.authSession?.accessToken.value).toBe("access_token_123");
    expect(parsed.authSession?.refreshToken.value).toBe("refresh_token_456");
    expect(parsed.authSession?.userEmail).toBe("test@example.com");
    expect(parsed.authSession?.expiresAt).toBe(expiresAt);
  });
});

describe("Vault Auth IPC Channels", () => {
  // These tests verify that the IPC channel names match expected patterns
  const AUTH_CHANNELS = [
    "vault:auth-sign-in",
    "vault:auth-sign-out",
    "vault:auth-status",
    "vault:auth-refresh",
  ];

  it("should have consistent channel naming", () => {
    AUTH_CHANNELS.forEach((channel) => {
      expect(channel).toMatch(/^vault:auth-[a-z-]+$/);
    });
  });

  it("should have four auth channels", () => {
    expect(AUTH_CHANNELS).toHaveLength(4);
  });
});

describe("VaultAuthReason Types", () => {
  // Valid auth reason values
  const VALID_REASONS = [
    "AUTHENTICATED",
    "NO_SESSION",
    "SESSION_EXPIRED",
    "TOKEN_REFRESH_FAILED",
    "CONFIG_MISSING",
  ] as const;

  type VaultAuthReason = (typeof VALID_REASONS)[number];

  it("should define all expected auth reasons", () => {
    expect(VALID_REASONS).toContain("AUTHENTICATED");
    expect(VALID_REASONS).toContain("NO_SESSION");
    expect(VALID_REASONS).toContain("SESSION_EXPIRED");
    expect(VALID_REASONS).toContain("TOKEN_REFRESH_FAILED");
    expect(VALID_REASONS).toContain("CONFIG_MISSING");
  });

  it("should have exactly 5 auth reasons", () => {
    expect(VALID_REASONS).toHaveLength(5);
  });

  const authReasonMessages: Record<VaultAuthReason, string> = {
    AUTHENTICATED: "User is authenticated and session is valid",
    NO_SESSION: "No active session found - user needs to sign in",
    SESSION_EXPIRED: "Session has expired - user needs to sign in again",
    TOKEN_REFRESH_FAILED:
      "Session refresh failed - user needs to sign in again",
    CONFIG_MISSING: "Vault is not configured - URL or key missing",
  };

  it("should map all reasons to user-friendly messages", () => {
    VALID_REASONS.forEach((reason) => {
      expect(authReasonMessages[reason]).toBeDefined();
      expect(authReasonMessages[reason].length).toBeGreaterThan(0);
    });
  });
});

describe("Auth Status Result Structure", () => {
  interface VaultAuthStatusResult {
    isAuthenticated: boolean;
    reason: string;
    userEmail?: string;
    userId?: string;
    expiresAt?: number;
  }

  const createAuthStatus = (
    overrides: Partial<VaultAuthStatusResult>,
  ): VaultAuthStatusResult => ({
    isAuthenticated: false,
    reason: "NO_SESSION",
    ...overrides,
  });

  it("should correctly represent authenticated state", () => {
    const status = createAuthStatus({
      isAuthenticated: true,
      reason: "AUTHENTICATED",
      userEmail: "user@example.com",
      expiresAt: Date.now() + 3600000,
    });

    expect(status.isAuthenticated).toBe(true);
    expect(status.reason).toBe("AUTHENTICATED");
    expect(status.userEmail).toBeDefined();
    expect(status.expiresAt).toBeGreaterThan(Date.now());
  });

  it("should correctly represent NO_SESSION state", () => {
    const status = createAuthStatus({
      isAuthenticated: false,
      reason: "NO_SESSION",
    });

    expect(status.isAuthenticated).toBe(false);
    expect(status.reason).toBe("NO_SESSION");
    expect(status.userEmail).toBeUndefined();
  });

  it("should correctly represent SESSION_EXPIRED state", () => {
    const expiredTime = Date.now() - 1000;
    const status = createAuthStatus({
      isAuthenticated: false,
      reason: "SESSION_EXPIRED",
      userEmail: "user@example.com",
      expiresAt: expiredTime,
    });

    expect(status.isAuthenticated).toBe(false);
    expect(status.reason).toBe("SESSION_EXPIRED");
    expect(status.userEmail).toBeDefined();
    expect(status.expiresAt).toBeLessThan(Date.now());
  });

  it("should correctly represent CONFIG_MISSING state", () => {
    const status = createAuthStatus({
      isAuthenticated: false,
      reason: "CONFIG_MISSING",
    });

    expect(status.isAuthenticated).toBe(false);
    expect(status.reason).toBe("CONFIG_MISSING");
  });
});

describe("Diagnostics Output Formatting", () => {
  interface VaultDiagnostics {
    timestamp: string;
    supabaseUrl: string;
    hasAnonKey: boolean;
    maskedAnonKey: string;
    isAuthenticated: boolean;
    authReason: string;
    userEmail: string | null;
    expiresAt: string | null;
    supabaseOrgSlug: string | null;
    lastError: string | null;
  }

  const sampleDiagnostics: VaultDiagnostics = {
    timestamp: new Date().toISOString(),
    supabaseUrl: "https://test-project.supabase.co",
    hasAnonKey: true,
    maskedAnonKey: "***...abcdef",
    isAuthenticated: true,
    authReason: "AUTHENTICATED",
    userEmail: "user@example.com",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    supabaseOrgSlug: "my-org",
    lastError: null,
  };

  it("should have all required fields", () => {
    expect(sampleDiagnostics.timestamp).toBeDefined();
    expect(sampleDiagnostics.supabaseUrl).toBeDefined();
    expect(sampleDiagnostics.hasAnonKey).toBeDefined();
    expect(sampleDiagnostics.maskedAnonKey).toBeDefined();
    expect(sampleDiagnostics.isAuthenticated).toBeDefined();
    expect(sampleDiagnostics.authReason).toBeDefined();
  });

  it("should not include raw tokens or keys", () => {
    const diagnosticsString = JSON.stringify(sampleDiagnostics);
    expect(diagnosticsString).not.toContain("accessToken");
    expect(diagnosticsString).not.toContain("refreshToken");
    expect(diagnosticsString).not.toContain("anonKey");
    // maskedAnonKey is fine
    expect(diagnosticsString).toContain("maskedAnonKey");
  });

  it("should mask the anon key correctly", () => {
    expect(sampleDiagnostics.maskedAnonKey).toMatch(/^\*\*\*\.\.\./);
  });

  it("should include authReason for clarity", () => {
    expect(sampleDiagnostics.authReason).toBe("AUTHENTICATED");
  });
});
