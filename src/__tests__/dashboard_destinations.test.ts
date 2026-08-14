import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildConnectedServices } from "@/lib/dashboard/connected_services";
import { buildHealthRows } from "@/lib/dashboard/system_health";
import type { UserSettings } from "@/lib/schemas";

/**
 * Every row on the dashboard is a link, and a link to a route that does not
 * exist fails silently: the click does nothing and the row looks broken for no
 * stated reason. Two of them shipped that way, pointing at "/github-manager"
 * and "/vercel-manager" when the routes are under /devops.
 *
 * So: every destination the dashboard can produce must resolve to a registered
 * route.
 */

const routesDir = path.join(process.cwd(), "src", "routes");

/** Every path declared by a route file. */
function registeredPaths(): string[] {
  const paths: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, "utf8");
      for (const match of source.matchAll(/path:\s*"([^"]+)"/g)) {
        paths.push(match[1]);
      }
    }
  };

  walk(routesDir);
  return paths;
}

/**
 * A destination resolves when a route claims it outright, or claims a prefix of
 * it — which is how the nested provider screens under /settings work.
 */
function resolves(destination: string, paths: string[]): boolean {
  return paths.some(
    (candidate) =>
      candidate === destination || destination.startsWith(`${candidate}/`),
  );
}

/** Every destination the dashboard is capable of rendering. */
function everyDestination(): Array<{ id: string; to: string }> {
  const health = buildHealthRows({
    infrastructure: { healthy: 1, degraded: 0, offline: 0, total: 1 },
    providers: { configured: 1 },
    dataSources: { total: 1, connected: 1, errored: 0 },
    storage: { localVaultReady: true, cloudConnected: true },
    vector: { state: "ready", message: "Ready" },
  });

  // Everything switched on at once, so every optional row is produced.
  const services = buildConnectedServices({
    settings: {
      githubAccessToken: { value: "x" },
      vercelAccessToken: { value: "x" },
      neon: { accessToken: { value: "x" } },
      cloudflareApiToken: { value: "x" },
      pixabayApiKey: { value: "x" },
      supabase: { accessToken: { value: "x" } },
    } as unknown as UserSettings,
    providers: [{ id: "openai", name: "OpenAI" }],
    mcpServerCount: 1,
    dataSourceCount: 1,
  });

  return [...health, ...services].map((row) => ({ id: row.id, to: row.to }));
}

describe("dashboard destinations", () => {
  const paths = registeredPaths();

  it("finds the routes to check against", () => {
    // If this breaks, the rest of this file is silently passing on an empty
    // list rather than checking anything.
    expect(paths.length).toBeGreaterThan(20);
    expect(paths).toContain("/dashboard");
  });

  it("covers both the health rows and the service rows", () => {
    const destinations = everyDestination();
    expect(destinations.length).toBeGreaterThanOrEqual(12);
  });

  for (const destination of everyDestination()) {
    it(`${destination.id} links somewhere that exists`, () => {
      expect(
        resolves(destination.to, paths),
        `${destination.id} points at ${destination.to}, which no route claims`,
      ).toBe(true);
    });
  }
});
