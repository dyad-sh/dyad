import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { apps } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { withLock } from "@/ipc/utils/lock_utils";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { ImageGenerationService } from "./image_generation_service";

const { mockGenerateImageWithUserProvider } = vi.hoisted(() => ({
  mockGenerateImageWithUserProvider: vi.fn(),
}));

vi.mock("@/ipc/pi/image_generation", () => ({
  generateImage: mockGenerateImageWithUserProvider,
}));

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  const { default: nodePath } = await import("node:path");
  const { default: nodeOs } = await import("node:os");
  return {
    ...actual,
    getDyadAppPath: (appPath: string) =>
      nodePath.join(nodeOs.tmpdir(), "dyad-image-generation-tests", appPath),
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function abortableGeneration(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = () =>
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) {
      rejectAbort();
    } else {
      signal?.addEventListener("abort", rejectAbort, { once: true });
    }
  });
}

describe("ImageGenerationService", () => {
  const tempBase = path.join(os.tmpdir(), "dyad-image-generation-tests");
  let harness: HandlerTestHarness;
  let appId: number;
  let service: ImageGenerationService;

  beforeEach(() => {
    fs.rmSync(tempBase, { recursive: true, force: true });
    harness = setupHandlerTestHarness();
    service = new ImageGenerationService();
    const result = harness.db
      .insert(apps)
      .values({ name: "Test app", path: "test-app" })
      .run();
    appId = Number(result.lastInsertRowid);
    fs.mkdirSync(path.join(tempBase, "test-app"), { recursive: true });
    mockGenerateImageWithUserProvider.mockReset();
    mockGenerateImageWithUserProvider.mockResolvedValue({
      data: Buffer.from("image").toString("base64"),
      mimeType: "image/png",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    harness.dispose();
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  function generate(requestId: string) {
    return service.generate({
      requestId,
      prompt: "A tiny lighthouse",
      themeMode: "plain",
      targetAppId: appId,
    });
  }

  async function cancel(requestId: string): Promise<{ cancelled: boolean }> {
    return { cancelled: service.cancel(requestId) };
  }

  it("rejects admission while an app deletion or reset fence is active", () => {
    service.beginAppDeletion(appId);
    expect(() => generate("during-delete")).toThrow("The app is being deleted");
    service.endAppDeletion(appId);

    service.beginReset();
    expect(() => generate("during-reset")).toThrow("The app is being deleted");
    service.endReset();
  });

  it("uses the user's image provider", async () => {
    const result = await generate("user-provider");

    expect(mockGenerateImageWithUserProvider).toHaveBeenCalledWith(
      "A tiny lighthouse",
      expect.any(AbortSignal),
    );
    expect(fs.readFileSync(result.filePath)).toEqual(Buffer.from("image"));
  });

  it("aborts the initial generation request", async () => {
    mockGenerateImageWithUserProvider.mockImplementation(
      (_prompt: string, signal?: AbortSignal) => abortableGeneration(signal),
    );

    const generation = generate("generation-phase");
    await vi.waitFor(() =>
      expect(mockGenerateImageWithUserProvider).toHaveBeenCalledOnce(),
    );

    await expect(cancel("generation-phase")).resolves.toEqual({
      cancelled: true,
    });
    await expect(generation).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    await expect(cancel("generation-phase")).resolves.toEqual({
      cancelled: false,
    });
  });

  it("checks for cancellation inside the media lock before writing", async () => {
    const mkdirStarted = deferred<void>();
    const releaseMkdir = deferred<void>();
    vi.spyOn(fs.promises, "mkdir").mockImplementationOnce(async () => {
      mkdirStarted.resolve();
      await releaseMkdir.promise;
      return undefined;
    });
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    const generation = generate("pre-write-phase");
    await mkdirStarted.promise;
    await expect(cancel("pre-write-phase")).resolves.toEqual({
      cancelled: true,
    });
    releaseMkdir.resolve();

    await expect(generation).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    expect(writeFile).not.toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/),
      expect.any(Buffer),
      expect.anything(),
    );
  });

  it("aborts and cleans up a file write when generation is cancelled", async () => {
    const writeStarted = deferred<void>();
    const originalWriteFile = fs.promises.writeFile;
    const writeFile = vi
      .spyOn(fs.promises, "writeFile")
      .mockImplementation(async (file, data, options) => {
        if (!String(file).endsWith(".tmp")) {
          return originalWriteFile(file, data, options);
        }
        const signal = (options as { signal?: AbortSignal } | undefined)
          ?.signal;
        writeStarted.resolve();
        await abortableGeneration(signal);
      });
    const rename = vi.spyOn(fs.promises, "rename");
    const rm = vi.spyOn(fs.promises, "rm");

    const generation = generate("file-write-phase");
    await writeStarted.promise;
    await expect(cancel("file-write-phase")).resolves.toEqual({
      cancelled: true,
    });

    await expect(generation).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/),
      expect.any(Buffer),
      { signal: expect.any(AbortSignal) },
    );
    expect(rename).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), {
      force: true,
    });
  });

  it("serializes with app moves and saves using the refreshed app path", async () => {
    const appLockAcquired = deferred<void>();
    const releaseAppLock = deferred<void>();
    const relocation = withLock(appId, async () => {
      appLockAcquired.resolve();
      await releaseAppLock.promise;
      const movedAppPath = path.join(tempBase, "moved-app");
      await fs.promises.mkdir(movedAppPath, { recursive: true });
      harness.db
        .update(apps)
        .set({ path: "moved-app", name: "Moved app" })
        .where(eq(apps.id, appId))
        .run();
    });
    await appLockAcquired.promise;

    const generation = generate("move-during-generation");
    await vi.waitFor(() =>
      expect(mockGenerateImageWithUserProvider).toHaveBeenCalledOnce(),
    );
    releaseAppLock.resolve();
    await relocation;

    await expect(generation).resolves.toMatchObject({
      appPath: "moved-app",
      appName: "Moved app",
      filePath: expect.stringContaining(path.join("moved-app", ".dyad")),
    });
    await expect(
      fs.promises.readFile(
        path.join(tempBase, "moved-app", ".gitignore"),
        "utf-8",
      ),
    ).resolves.toContain(".dyad/");
    expect(
      fs.existsSync(path.join(tempBase, "test-app", ".dyad", "media")),
    ).toBe(false);
  });

  it("removes failed requests from the active controller registry", async () => {
    mockGenerateImageWithUserProvider.mockRejectedValue(
      new Error("provider failed"),
    );

    await expect(generate("failed-request")).rejects.toThrow("provider failed");
    await expect(cancel("failed-request")).resolves.toEqual({
      cancelled: false,
    });
  });
});
