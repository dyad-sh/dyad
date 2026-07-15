// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureTrustedRenderer } from "../utils/renderer_security";

const mocks = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
  >(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (
          event: unknown,
          ...args: unknown[]
        ) => Promise<unknown> | unknown,
      ) => mocks.handlers.set(channel, handler),
    ),
  },
}));

const { registerTrustedIpcHandler } = await import("./trusted_handle");

function eventFor(url: string) {
  const frame = { url };
  return { sender: { mainFrame: frame }, senderFrame: frame };
}

function listProductionTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["__tests__", "testing", "fixtures"].includes(entry.name)) {
        return [];
      }
      return listProductionTypeScriptFiles(entryPath);
    }
    if (
      !/\.tsx?$/.test(entry.name) ||
      /\.(?:test|spec)\.tsx?$/.test(entry.name)
    ) {
      return [];
    }
    return [entryPath];
  });
}

describe("registerTrustedIpcHandler", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    configureTrustedRenderer({
      devServerUrl: "http://localhost:5173",
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
  });

  it("runs handlers for the trusted renderer", async () => {
    const implementation = vi.fn(async (_event, value: number) => value * 2);
    registerTrustedIpcHandler("trusted", implementation);

    await expect(
      mocks.handlers.get("trusted")?.(
        eventFor("http://localhost:5173/chat"),
        21,
      ),
    ).resolves.toBe(42);
    expect(implementation).toHaveBeenCalledOnce();
  });

  it("rejects untrusted renderers before running the handler", async () => {
    const implementation = vi.fn();
    registerTrustedIpcHandler("untrusted", implementation);

    await expect(
      mocks.handlers.get("untrusted")?.(eventFor("https://attacker.example/")),
    ).rejects.toThrow("trusted Dyad renderer");
    expect(implementation).not.toHaveBeenCalled();
  });

  it("lets envelope-based handlers map trust failures", async () => {
    const implementation = vi.fn();
    const mapTrustFailure = vi.fn((error: unknown) => ({ error }));
    registerTrustedIpcHandler("mapped", implementation, {
      onTrustFailure: mapTrustFailure,
    });

    const result = await mocks.handlers.get("mapped")?.(
      eventFor("https://attacker.example/"),
    );

    expect(result).toEqual({ error: expect.any(Error) });
    expect(mapTrustFailure).toHaveBeenCalledOnce();
    expect(implementation).not.toHaveBeenCalled();
  });

  it("is the only production entry point for ipcMain invoke handlers", () => {
    const sourceRoot = path.join(process.cwd(), "src");
    const facadePath = path.join(
      sourceRoot,
      "ipc",
      "handlers",
      "trusted_handle.ts",
    );
    const directRegistrations = listProductionTypeScriptFiles(sourceRoot)
      .filter((filePath) => filePath !== facadePath)
      .filter((filePath) =>
        /\bipcMain\s*(?:\?\.|\.)\s*handle(?:Once)?\s*\(/.test(
          fs.readFileSync(filePath, "utf8"),
        ),
      )
      .map((filePath) => path.relative(process.cwd(), filePath));

    expect(directRegistrations).toEqual([]);
  });
});
