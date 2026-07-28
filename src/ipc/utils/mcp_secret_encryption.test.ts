import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";

const isEncryptionAvailable = vi.fn(() => true);

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => isEncryptionAvailable(),
    encryptString: (s: string) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (b: Buffer) => {
      const s = b.toString("utf8");
      if (!s.startsWith("enc:")) throw new Error("not encrypted by this mock");
      return s.slice("enc:".length);
    },
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { setDatabaseForTesting } from "@/db";
import { mcpServers } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { encryptStoredMcpSecrets } from "./mcp_secret_encryption";

let db: TestDb;

function decode(blob: string | null): string | null {
  return blob === null ? null : Buffer.from(blob, "base64").toString("utf8");
}

async function readRow(id: number) {
  const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
  return row;
}

describe("encryptStoredMcpSecrets", () => {
  beforeEach(() => {
    isEncryptionAvailable.mockReturnValue(true);
    db = createInMemoryTestDb();
    setDatabaseForTesting(db);
  });

  afterEach(() => {
    setDatabaseForTesting(null);
    db.$client.close();
  });

  it("encrypts existing headers and env vars", async () => {
    await db.insert(mcpServers).values([
      {
        id: 1,
        name: "http",
        transport: "http",
        url: "https://example.com/mcp",
        headersJson: { Authorization: "Bearer sk-1" },
      },
      {
        id: 2,
        name: "stdio",
        transport: "stdio",
        command: "npx",
        envJson: { API_KEY: "sk-2" },
      },
    ]);

    expect(await encryptStoredMcpSecrets()).toBe(2);

    expect(decode((await readRow(1)).headersEncrypted)).toBe(
      `enc:{"Authorization":"Bearer sk-1"}`,
    );
    expect(decode((await readRow(2)).envEncrypted)).toBe(
      `enc:{"API_KEY":"sk-2"}`,
    );
  });

  it("leaves the plaintext columns intact", async () => {
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { Authorization: "Bearer sk-1" },
    });

    await encryptStoredMcpSecrets();

    expect((await readRow(1)).headersJson).toEqual({
      Authorization: "Bearer sk-1",
    });
  });

  it("is a no-op on the second run", async () => {
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { Authorization: "Bearer sk-1" },
    });

    expect(await encryptStoredMcpSecrets()).toBe(1);
    expect(await encryptStoredMcpSecrets()).toBe(0);
  });

  it("does not overwrite an already-encrypted column", async () => {
    const existing = Buffer.from(`enc:{"A":"kept"}`, "utf8").toString("base64");
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "ignored" },
      headersEncrypted: existing,
    });

    expect(await encryptStoredMcpSecrets()).toBe(0);
    expect((await readRow(1)).headersEncrypted).toBe(existing);
  });

  it("picks up a row whose encrypted column was cleared by an older build", async () => {
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "rewritten" },
      headersEncrypted: null,
    });

    expect(await encryptStoredMcpSecrets()).toBe(1);
    expect(decode((await readRow(1)).headersEncrypted)).toBe(
      `enc:{"A":"rewritten"}`,
    );
  });

  it("skips servers with no headers or env vars", async () => {
    await db.insert(mcpServers).values({
      id: 1,
      name: "bare",
      transport: "http",
      url: "https://example.com/mcp",
    });

    expect(await encryptStoredMcpSecrets()).toBe(0);
    const row = await readRow(1);
    expect(row.headersEncrypted).toBeNull();
    expect(row.envEncrypted).toBeNull();
  });

  it("writes the plaintext fallback when no keyring is available", async () => {
    isEncryptionAvailable.mockReturnValue(false);
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "1" },
    });

    expect(await encryptStoredMcpSecrets()).toBe(1);
    expect((await readRow(1)).headersEncrypted).toMatch(/^plain:/);
  });

  it("returns 0 instead of throwing when the query fails", async () => {
    db.$client.close();
    expect(await encryptStoredMcpSecrets()).toBe(0);
  });
});
