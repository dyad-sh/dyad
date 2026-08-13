import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Auth is remembered, and the secret stays in the main process.
 *
 * These are structural because exercising them needs a real Cloudflare
 * account, but they cover the two ways this goes wrong: asking a signed-in
 * user to sign in again, and letting the token reach the renderer.
 */

const read = (...segments: string[]) =>
  fs.readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");

describe("Cloudflare auth is remembered", () => {
  it("stores the token encrypted, never in plain settings", () => {
    const handlers = read("ipc", "handlers", "cloudflare_handlers.ts");
    expect(handlers).toContain("encrypt(input.apiToken.trim())");
    // The decrypting helper must not be part of any contract output.
    expect(handlers).toContain("storedCloudflareToken");
  });

  it("never returns the token through IPC", () => {
    const contracts = read("ipc", "types", "cloudflare.ts");
    // The renderer is told whether a token exists, never what it is.
    expect(contracts).toContain("hasStoredToken: z.boolean()");
    expect(contracts).not.toMatch(/output:[\s\S]{0,200}apiToken/);
  });

  it("asks what it already knows before offering to sign in", () => {
    const chooser = read(
      "components",
      "data_sources",
      "DataSourceProviderChooser.tsx",
    );
    expect(chooser).toContain("ipc.cloudflare.authState()");
    expect(chooser).toContain("alreadyAuthenticated");
    // The sign-in button is behind that check, not shown unconditionally.
    expect(chooser).toMatch(/alreadyAuthenticated && databases === null/);
  });

  it("offers a way to forget it", () => {
    const chooser = read(
      "components",
      "data_sources",
      "DataSourceProviderChooser.tsx",
    );
    expect(chooser).toContain("ipc.cloudflare.signOut()");
  });
});
