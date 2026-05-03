/**
 * Tests for the joybridge_handlers module's pure surface — the channel set,
 * env-overlay behaviour, and the test seam (`__test__.ensureClient`).
 *
 * The actual `ipcMain.handle()` dispatch is exercised end-to-end at runtime;
 * these tests cover the decisions that bit us in MEMORY.md:
 *   - the preload channel list is in sync with the handler list (CHANNELS)
 *   - env vars override stored config so CI / dev can swap backends
 *   - publishable key never leaks via getConfig()
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock electron BEFORE importing the handler module. ipcMain.handle is a no-op,
// app.getPath returns a temp dir so the JSON config file lives somewhere safe.
const handlersByChannel = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlersByChannel.set(channel, fn);
    },
  },
  app: {
    getPath: () => process.cwd(), // tests don't actually write disk
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
  },
}));

// fs-extra: mock pathExists / readJson / writeJson to keep tests in-memory
vi.mock("fs-extra", () => ({
  pathExists: async () => false,
  readJson: async () => ({}),
  writeJson: async () => undefined,
}));

import {
  __test__ as joybridgeTest,
  registerJoyBridgeHandlers,
} from "@/ipc/handlers/joybridge_handlers";
import { JoyBridgeClient } from "@/lib/joybridge_client";
import { __test__ as _t } from "@/ipc/handlers/joybridge_handlers";

const ENV_KEYS = [
  "JOYBRIDGE_API_BASE",
  "JOYMARKETPLACE_API_URL",
  "JOYBRIDGE_WEB_BASE",
  "JOYMARKETPLACE_WEB_URL",
  "SUPABASE_URL",
  "JOYMARKETPLACE_SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "JOYMARKETPLACE_SUPABASE_ANON_KEY",
  "JOY_API_KEY",
];

describe("joybridge_handlers — channel surface", () => {
  it("declares 11 unique IPC channels", () => {
    expect(joybridgeTest.CHANNELS.length).toBe(11);
    const set = new Set(joybridgeTest.CHANNELS);
    expect(set.size).toBe(11);
  });

  it("every channel name is namespaced under joybridge:", () => {
    for (const c of joybridgeTest.CHANNELS) {
      expect(c.startsWith("joybridge:")).toBe(true);
    }
  });

  it("channel set matches exactly the documented list (audit guard)", () => {
    expect([...joybridgeTest.CHANNELS].sort()).toEqual(
      [
        "joybridge:browse-marketplace",
        "joybridge:connect",
        "joybridge:create-store",
        "joybridge:get-asset",
        "joybridge:get-config",
        "joybridge:get-store",
        "joybridge:goldsky-query",
        "joybridge:list-my-assets",
        "joybridge:list-my-stores",
        "joybridge:pin-to-ipfs",
        "joybridge:publish-asset",
      ].sort(),
    );
  });
});

describe("joybridge_handlers — env overlay", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    joybridgeTest.resetForTests();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("env JOYBRIDGE_API_BASE wins over default", async () => {
    process.env.JOYBRIDGE_API_BASE = "https://stage.example/api/v1";
    await joybridgeTest.loadConfig();
    const c = joybridgeTest.ensureClient(true);
    expect(c.getConfig().apiBase).toBe("https://stage.example/api/v1");
  });

  it("env SUPABASE_PUBLISHABLE_KEY surfaces in supabaseConfigured (with URL)", async () => {
    process.env.SUPABASE_URL = "https://xyz.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    await joybridgeTest.loadConfig();
    const c = joybridgeTest.ensureClient(true);
    expect(c.getConfig().supabaseConfigured).toBe(true);
  });

  it("publishable key NEVER appears in getConfig() output", async () => {
    process.env.SUPABASE_URL = "https://xyz.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_secret_value";
    process.env.JOY_API_KEY = "joy_super_secret";
    await joybridgeTest.loadConfig();
    const c = joybridgeTest.ensureClient(true);
    const cfg = c.getConfig();
    const cfgJson = JSON.stringify(cfg);
    expect(cfgJson).not.toContain("sb_publishable_secret_value");
    expect(cfgJson).not.toContain("joy_super_secret");
  });
});

describe("joybridge_handlers — register dispatches handlers for every channel", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    handlersByChannel.clear();
    joybridgeTest.resetForTests();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("registerJoyBridgeHandlers wires up all 11 channels via ipcMain.handle", () => {
    registerJoyBridgeHandlers();
    for (const ch of joybridgeTest.CHANNELS) {
      expect(handlersByChannel.has(ch)).toBe(true);
    }
  });

  it("get-config dispatcher returns the client config", async () => {
    registerJoyBridgeHandlers();
    const fn = handlersByChannel.get("joybridge:get-config");
    expect(fn).toBeTypeOf("function");
    // ipcMain handlers receive (event, ...args) at runtime; we pass a stub event.
    const result = await fn!({} as unknown);
    // Diagnostic surface so failures are debuggable.
    const cfg = result as { apiBase?: string; connected?: boolean };
    expect(typeof cfg.apiBase, `result was ${JSON.stringify(result)}`).toBe("string");
    expect((cfg.apiBase ?? "").length).toBeGreaterThan(0);
    expect(cfg.connected).toBe(false);
  });

  it("test seam allows injecting a stub client", async () => {
    const stub = new JoyBridgeClient({
      apiBase: "https://stub.test",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: true }))) as unknown as typeof fetch,
    });
    joybridgeTest.setClientForTests(stub);
    registerJoyBridgeHandlers();
    const fn = handlersByChannel.get("joybridge:get-config");
    const cfg = (await fn!()) as { apiBase: string };
    // ensureClient(false) should reuse the existing stub.
    expect(cfg.apiBase).toBe("https://stub.test");
  });
});

// Eliminate unused-import lint errors when this file is read but not run on
// every Vitest cycle.
void _t;
