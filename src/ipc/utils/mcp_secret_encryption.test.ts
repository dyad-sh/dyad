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

  it("leaves a row alone when both columns already agree", async () => {
    const existing = Buffer.from(`enc:{"A":"same"}`, "utf8").toString("base64");
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "same" },
      headersEncrypted: existing,
    });

    expect(await encryptStoredMcpSecrets()).toBe(0);
    expect((await readRow(1)).headersEncrypted).toBe(existing);
  });

  it("re-encrypts when an older build edited the plaintext column", async () => {
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "rotated" },
      headersEncrypted: Buffer.from(`enc:{"A":"stale"}`, "utf8").toString(
        "base64",
      ),
    });

    expect(await encryptStoredMcpSecrets()).toBe(1);
    expect(decode((await readRow(1)).headersEncrypted)).toBe(
      `enc:{"A":"rotated"}`,
    );
  });

  it("re-encrypts when the stored blob can't be decrypted at all", async () => {
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "recoverable" },
      headersEncrypted: Buffer.from("garbage", "utf8").toString("base64"),
    });

    expect(await encryptStoredMcpSecrets()).toBe(1);
    expect(decode((await readRow(1)).headersEncrypted)).toBe(
      `enc:{"A":"recoverable"}`,
    );
  });

  it("upgrades a plain: blob once a keyring is available", async () => {
    isEncryptionAvailable.mockReturnValue(false);
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "1" },
    });
    await encryptStoredMcpSecrets();
    // The plaintext column is what a build predating the encrypted
    // columns reads; clear it so only the plain: blob is left.
    await db
      .update(mcpServers)
      .set({ headersJson: null })
      .where(eq(mcpServers.id, 1));
    expect((await readRow(1)).headersEncrypted).toMatch(/^plain:/);

    isEncryptionAvailable.mockReturnValue(true);
    expect(await encryptStoredMcpSecrets()).toBe(1);
    expect(decode((await readRow(1)).headersEncrypted)).toBe(`enc:{"A":"1"}`);
  });

  it("upgrades a plain: blob even when the plaintext column still matches", async () => {
    isEncryptionAvailable.mockReturnValue(false);
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "1" },
    });
    await encryptStoredMcpSecrets();
    expect((await readRow(1)).headersEncrypted).toMatch(/^plain:/);

    isEncryptionAvailable.mockReturnValue(true);
    expect(await encryptStoredMcpSecrets()).toBe(1);
    expect(decode((await readRow(1)).headersEncrypted)).toBe(`enc:{"A":"1"}`);
    // The plaintext column is still there, so a repeat pass must not
    // treat the row as needing work again.
    expect(await encryptStoredMcpSecrets()).toBe(0);
  });

  it("rewrites a plain: blob an older build changed, even with no keyring", async () => {
    isEncryptionAvailable.mockReturnValue(false);
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { A: "rotated" },
      headersEncrypted: `plain:${Buffer.from(`{"A":"stale"}`, "utf8").toString("base64")}`,
    });

    expect(await encryptStoredMcpSecrets()).toBe(1);
    const stored = (await readRow(1)).headersEncrypted!;
    expect(stored.startsWith("plain:")).toBe(true);
    expect(
      Buffer.from(stored.slice("plain:".length), "base64").toString("utf8"),
    ).toBe(`{"A":"rotated"}`);
    expect(await encryptStoredMcpSecrets()).toBe(0);
  });

  it("leaves a plain: blob alone while no keyring exists", async () => {
    isEncryptionAvailable.mockReturnValue(false);
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersEncrypted: `plain:${Buffer.from(`{"A":"1"}`, "utf8").toString("base64")}`,
    });

    expect(await encryptStoredMcpSecrets()).toBe(0);
  });

  it("clears the encrypted column when an older build removed the last secret", async () => {
    await db.insert(mcpServers).values({
      id: 1,
      name: "http",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: {},
      headersEncrypted: Buffer.from(`enc:{"A":"deleted"}`, "utf8").toString(
        "base64",
      ),
    });

    expect(await encryptStoredMcpSecrets()).toBe(1);
    expect((await readRow(1)).headersEncrypted).toBeNull();
    // A second pass has nothing left to do.
    expect(await encryptStoredMcpSecrets()).toBe(0);
  });

  it("does not rewrite a server whose last secret was removed", async () => {
    await db.insert(mcpServers).values({
      id: 1,
      name: "stdio",
      transport: "stdio",
      command: "npx",
      envJson: {},
    });

    expect(await encryptStoredMcpSecrets()).toBe(0);
    expect(await encryptStoredMcpSecrets()).toBe(0);
    expect((await readRow(1)).envEncrypted).toBeNull();
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
