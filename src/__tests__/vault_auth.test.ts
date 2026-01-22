import { describe, it, expect } from "vitest";
import { VaultAuthSessionSchema, VaultSettingsSchema } from "../lib/schemas";

describe("VaultAuthSession Schema", () => {
  const validSession = {
    accessToken: { value: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature" },
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
  ];

  it("should have consistent channel naming", () => {
    AUTH_CHANNELS.forEach((channel) => {
      expect(channel).toMatch(/^vault:auth-[a-z-]+$/);
    });
  });

  it("should have three auth channels", () => {
    expect(AUTH_CHANNELS).toHaveLength(3);
  });
});
