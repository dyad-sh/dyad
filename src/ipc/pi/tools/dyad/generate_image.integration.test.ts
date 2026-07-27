// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createImagesProvider } from "@earendil-works/pi-ai";
import * as openrouterImagesApi from "@earendil-works/pi-ai/api/openrouter-images";

import {
  getPiImageModels,
  resetPiModelRuntimeForTesting,
} from "@/ipc/pi/model_runtime";
import * as imageGeneration from "@/ipc/pi/image_generation";
import { DyadErrorKind } from "@/errors/dyad_error";
import { generateImageTool } from "./generate_image";
import type { AgentContext } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  resetPiModelRuntimeForTesting();
});

function createContext(appPath: string, signal: AbortSignal): AgentContext {
  return {
    appPath,
    abortSignal: signal,
    onXmlStream: () => {},
    onXmlComplete: () => {},
  } as unknown as AgentContext;
}

async function getMediaEntries(appPath: string): Promise<string[]> {
  try {
    return await readdir(path.join(appPath, ".dyad", "media"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

describe("generate_image pi integration", () => {
  it("uses the pi image provider and saves the returned image in .dyad/media", async () => {
    let authorization: string | undefined;
    const png = Buffer.from("real-pi-image-bytes");
    const server = createServer(async (request, response) => {
      authorization = request.headers.authorization;
      for await (const _chunk of request) {
        // Drain request body.
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: "image-response",
          object: "chat.completion",
          created: 1,
          model: "openrouter/auto",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "",
                images: [
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${png.toString("base64")}`,
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
      );
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const appPath = await mkdtemp(path.join(tmpdir(), "dyad-pi-image-test-"));
    try {
      const address = server.address() as AddressInfo;
      const model = {
        id: "openrouter/auto",
        name: "OpenRouter Auto",
        api: "openrouter-images" as const,
        provider: "openrouter",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        input: ["text" as const],
        output: ["image" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
      getPiImageModels().setProvider(
        createImagesProvider({
          id: "openrouter",
          name: "OpenRouter test",
          auth: {
            apiKey: {
              name: "test key",
              resolve: async () => ({
                auth: { apiKey: "image-test-key" },
                source: "test",
              }),
            },
          },
          models: [model],
          api: openrouterImagesApi,
        }),
      );

      let completedXml = "";
      const result = await generateImageTool.execute(
        { prompt: "A tiny volcano" },
        {
          appPath,
          abortSignal: new AbortController().signal,
          onXmlStream: () => {},
          onXmlComplete: (xml: string) => {
            completedXml = xml;
          },
        } as unknown as AgentContext,
      );

      const relativePath = result.match(/saved to: (.+)\n/)?.[1];
      expect(relativePath).toBeTruthy();
      expect(await readFile(path.join(appPath, relativePath!))).toEqual(png);
      expect(completedXml).toContain(relativePath!);
      expect(authorization).toBe("Bearer image-test-key");
    } finally {
      await rm(appPath, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("removes the temporary image when cancellation races the completed write", async () => {
    const appPath = await mkdtemp(path.join(tmpdir(), "dyad-pi-image-test-"));
    const controller = new AbortController();
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(imageGeneration, "generateImage").mockResolvedValue({
      data: Buffer.from("image-bytes").toString("base64"),
      mimeType: "image/png",
    });
    const writeFile = vi
      .spyOn(fs, "writeFile")
      .mockImplementationOnce(async (file, data, options) => {
        await originalWriteFile(file, data, options);
        controller.abort();
      });

    try {
      await expect(
        generateImageTool.execute(
          { prompt: "cancel during write" },
          createContext(appPath, controller.signal),
        ),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.UserCancelled,
      });
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        expect.any(Buffer),
        { signal: controller.signal },
      );
      expect(await getMediaEntries(appPath)).toEqual([]);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("removes the finalized image when cancellation races the rename", async () => {
    const appPath = await mkdtemp(path.join(tmpdir(), "dyad-pi-image-test-"));
    const controller = new AbortController();
    const originalRename = fs.rename.bind(fs);
    vi.spyOn(imageGeneration, "generateImage").mockResolvedValue({
      data: Buffer.from("image-bytes").toString("base64"),
      mimeType: "image/png",
    });
    vi.spyOn(fs, "rename").mockImplementationOnce(async (from, to) => {
      await originalRename(from, to);
      controller.abort();
    });

    try {
      await expect(
        generateImageTool.execute(
          { prompt: "cancel after rename" },
          createContext(appPath, controller.signal),
        ),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.UserCancelled,
      });
      expect(await getMediaEntries(appPath)).toEqual([]);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });

  it("removes a partial temporary image when writing fails", async () => {
    const appPath = await mkdtemp(path.join(tmpdir(), "dyad-pi-image-test-"));
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(imageGeneration, "generateImage").mockResolvedValue({
      data: Buffer.from("image-bytes").toString("base64"),
      mimeType: "image/png",
    });
    vi.spyOn(fs, "writeFile").mockImplementationOnce(
      async (file, _data, _options) => {
        await originalWriteFile(file, Buffer.from("partial"));
        throw new Error("disk write failed");
      },
    );

    try {
      await expect(
        generateImageTool.execute(
          { prompt: "write failure" },
          createContext(appPath, new AbortController().signal),
        ),
      ).rejects.toThrow("disk write failed");
      expect(await getMediaEntries(appPath)).toEqual([]);
    } finally {
      await rm(appPath, { recursive: true, force: true });
    }
  });
});
