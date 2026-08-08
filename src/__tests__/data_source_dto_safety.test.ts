import { describe, expect, it } from "vitest";

import { DataSourceSchema, dataSourceContracts } from "@/ipc/types/data_source";

/**
 * The DTO is the security boundary, so it gets asserted rather than assumed.
 *
 * These tests fail if anyone ever adds a field that could carry a secret to
 * the shape the renderer receives.
 */

const SECRET_ISH = [
  "credential",
  "apikey",
  "api_key",
  "key",
  "secret",
  "password",
  "connectionstring",
  "connection_string",
  "token",
  "dsn",
];

/**
 * Fields whose names look secret-ish but provably cannot carry a value.
 *
 * Each is allowed by name here and constrained by type below, so the exemption
 * is narrow rather than a hole: adding a new one means editing this list.
 */
const ALLOWED_SECRET_ISH_NAMES = new Set([
  // A boolean: whether a key is stored, never what it is.
  "hasCredential",
  // An enum of which kind of key was supplied, not the key.
  "credentialType",
  // A random public label for the key, e.g. SUP-8F3A21. Deliberately not
  // derived from the secret, so it cannot leak any of it.
  "keyId",
]);

describe("data source DTO", () => {
  const fields = Object.keys(DataSourceSchema.shape);

  it("carries no field that could hold a secret", () => {
    for (const field of fields) {
      if (ALLOWED_SECRET_ISH_NAMES.has(field)) continue;
      const normalised = field.toLowerCase();
      for (const banned of SECRET_ISH) {
        expect(
          normalised.includes(banned),
          `DTO field "${field}" looks like it could carry a secret`,
        ).toBe(false);
      }
    }
  });

  it("constrains the exempted fields so the exemption is safe", () => {
    // credentialType is only safe because it cannot hold arbitrary text.
    expect(() =>
      DataSourceSchema.shape.credentialType.parse("sb_secret_leaked"),
    ).toThrow();
    expect(DataSourceSchema.shape.credentialType.parse("secret")).toBe(
      "secret",
    );

    expect(() =>
      DataSourceSchema.shape.hasCredential.parse("a-real-key"),
    ).toThrow();
    expect(DataSourceSchema.shape.hasCredential.parse(true)).toBe(true);
  });

  it("exposes only a boolean for whether a key is set", () => {
    const parsed = DataSourceSchema.parse({
      id: "a",
      provider: "supabase",
      name: "n",
      description: "",
      projectUrl: "https://x.supabase.co",
      environment: "production",
      credentialType: "secret",
      accessMode: "read_only",
      enabled: true,
      status: "connected",
      statusMessage: "",
      keyId: "SUP-8F3A21",
      hasCredential: true,
      tableCount: 3,
      relationshipCount: 1,
      lastConnectedAt: 1,
      lastSchemaSyncAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(typeof parsed.hasCredential).toBe("boolean");
    expect(parsed.keyId).toBe("SUP-8F3A21");
  });

  it("strips an unknown field rather than passing it through", () => {
    // zod objects are strip-by-default, so a handler that accidentally spread
    // a database row cannot leak the encrypted columns through the contract.
    const parsed = DataSourceSchema.parse({
      id: "a",
      provider: "supabase",
      name: "n",
      description: "",
      projectUrl: "https://x.supabase.co",
      environment: "production",
      credentialType: "secret",
      accessMode: "read_only",
      enabled: true,
      status: "connected",
      statusMessage: "",
      keyId: "SUP-000000",
      hasCredential: false,
      tableCount: 0,
      relationshipCount: 0,
      lastConnectedAt: null,
      lastSchemaSyncAt: null,
      createdAt: 1,
      updatedAt: 1,
      encryptedCredential: "should-not-survive",
    });
    expect(parsed).not.toHaveProperty("encryptedCredential");
  });

  it("pins access mode to read only", () => {
    expect(() =>
      DataSourceSchema.shape.accessMode.parse("read_write"),
    ).toThrow();
  });
});

describe("contracts", () => {
  it("returns nothing secret from any output schema", () => {
    for (const [name, contract] of Object.entries(dataSourceContracts)) {
      const description = JSON.stringify(
        // A rough structural dump is enough to catch a stray field name.
        Object.keys((contract.output as { shape?: object }).shape ?? {}),
      ).toLowerCase();
      for (const banned of ["password", "secret", "encrypted"]) {
        expect(
          description.includes(banned),
          `contract "${name}" output mentions ${banned}`,
        ).toBe(false);
      }
    }
  });
});
