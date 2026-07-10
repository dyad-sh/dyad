// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  deploySupabaseFunction,
  getSupabaseSharedFilesCacheStatsForTests,
  resetSupabaseSharedFilesCacheForTests,
} from "./supabase_management_client";
import { resetSupabaseDeployQueuesForTests } from "./supabase_deploy_queue";
import {
  MAX_SUPABASE_DEPLOY_FILE_BYTES,
  MAX_SUPABASE_DEPLOY_TOTAL_BYTES,
} from "./supabase_deploy_limits";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({
    supabase: {
      accessToken: { value: "test-token" },
      expiresIn: 60 * 60,
      tokenTimestamp: Math.floor(Date.now() / 1000),
    },
  })),
  writeSettings: vi.fn(),
}));

describe("Supabase function deployment memory bounds", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetSupabaseDeployQueuesForTests();
    resetSupabaseSharedFilesCacheForTests();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetSupabaseDeployQueuesForTests();
    resetSupabaseSharedFilesCacheForTests();
    await Promise.all(
      tempPaths
        .splice(0)
        .map((tempPath) => fs.rm(tempPath, { recursive: true, force: true })),
    );
  });

  it("rejects an oversized shared file before reading or uploading it", async () => {
    const appPath = await createApp();
    const sharedPath = path.join(
      appPath,
      "supabase",
      "functions",
      "_shared",
      "huge.bin",
    );
    await fs.mkdir(path.dirname(sharedPath), { recursive: true });
    await fs.writeFile(sharedPath, "");
    await fs.truncate(sharedPath, MAX_SUPABASE_DEPLOY_FILE_BYTES + 1);
    const fetchMock = vi.fn(() => {
      throw new Error("upload should not start");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deploy(appPath)).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("per-file limit"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an aggregate payload over the limit before allocating file buffers", async () => {
    const appPath = await createApp();
    const functionIndex = path.join(
      appPath,
      "supabase",
      "functions",
      "hello",
      "index.ts",
    );
    await fs.truncate(functionIndex, 12 * 1024 * 1024);

    const sharedDirectory = path.join(
      appPath,
      "supabase",
      "functions",
      "_shared",
    );
    await fs.mkdir(sharedDirectory, { recursive: true });
    for (const fileName of ["a.bin", "b.bin"]) {
      const filePath = path.join(sharedDirectory, fileName);
      await fs.writeFile(filePath, "");
      await fs.truncate(filePath, 11 * 1024 * 1024);
    }
    expect(12 * 1024 * 1024 + 2 * 11 * 1024 * 1024).toBeGreaterThan(
      MAX_SUPABASE_DEPLOY_TOTAL_BYTES,
    );
    const fetchMock = vi.fn(() => {
      throw new Error("upload should not start");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deploy(appPath)).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("aggregate limit"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rebuilds FormData for a normal rate-limit retry", async () => {
    const appPath = await createApp();
    await writeSharedFile(appPath, "export const value = 1;");
    const requestBodies: FormData[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBodies.push(init?.body as FormData);
      if (requestBodies.length === 1) {
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return successResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deploy(appPath)).resolves.toMatchObject({
      slug: "hello",
      status: "ACTIVE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).not.toBe(requestBodies[1]);
    expect(requestBodies[0].getAll("file")).toHaveLength(3);
    expect(requestBodies[1].getAll("file")).toHaveLength(3);
  });

  it("invalidates shared buffers after a source mtime or size change", async () => {
    const appPath = await createApp();
    await writeSharedFile(appPath, "export const value = 1;");
    const requestBodies: FormData[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBodies.push(init?.body as FormData);
        return successResponse();
      }),
    );

    await deploy(appPath);
    const firstStats = getSupabaseSharedFilesCacheStatsForTests();
    expect(firstStats.entries).toBe(1);

    const updatedSource = "export const value = 222;";
    await writeSharedFile(appPath, updatedSource);
    await deploy(appPath);

    const secondStats = getSupabaseSharedFilesCacheStatsForTests();
    expect(secondStats.entries).toBe(1);
    expect(secondStats.totalBytes).toBe(Buffer.byteLength(updatedSource));
    const latestSharedFile = requestBodies[1]
      .getAll("file")
      .find(
        (entry): entry is File =>
          entry instanceof File && entry.name === "_shared/helper.ts",
      );
    expect(latestSharedFile).toBeDefined();
    await expect(latestSharedFile!.text()).resolves.toBe(updatedSource);
  });

  async function createApp(): Promise<string> {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-supabase-memory-"),
    );
    tempPaths.push(appPath);
    const functionDirectory = path.join(
      appPath,
      "supabase",
      "functions",
      "hello",
    );
    await fs.mkdir(functionDirectory, { recursive: true });
    await fs.writeFile(
      path.join(functionDirectory, "index.ts"),
      "Deno.serve(() => new Response('ok'));",
    );
    return appPath;
  }

  async function writeSharedFile(
    appPath: string,
    source: string,
  ): Promise<void> {
    const sharedDirectory = path.join(
      appPath,
      "supabase",
      "functions",
      "_shared",
    );
    await fs.mkdir(sharedDirectory, { recursive: true });
    await fs.writeFile(path.join(sharedDirectory, "helper.ts"), source);
  }
});

function deploy(appPath: string) {
  return deploySupabaseFunction({
    supabaseProjectId: "project-id",
    functionName: "hello",
    appPath,
    bundleOnly: true,
    organizationSlug: null,
  });
}

function successResponse(): Response {
  return new Response(
    JSON.stringify({
      id: "function-id",
      slug: "hello",
      name: "hello",
      status: "ACTIVE",
      version: 1,
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    },
  );
}
