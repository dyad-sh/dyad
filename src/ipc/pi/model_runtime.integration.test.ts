// @vitest-environment node
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createResponsesHandler } from "../../../testing/fake-llm-server/responsesHandler";

import {
  getPiModels,
  resetPiModelRuntimeForTesting,
  resolveDyadModel,
} from "./model_runtime";

const originalLmStudioBaseUrl = process.env.LM_STUDIO_BASE_URL_FOR_TESTING;

afterEach(() => {
  resetPiModelRuntimeForTesting();
  if (originalLmStudioBaseUrl === undefined) {
    delete process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
  } else {
    process.env.LM_STUDIO_BASE_URL_FOR_TESTING = originalLmStudioBaseUrl;
  }
});

describe("pi model runtime HTTP integration", () => {
  it("streams a real OpenAI-compatible request to the configured LM Studio endpoint", async () => {
    let requestBody: unknown;
    const server = createServer(
      async (request: IncomingMessage, response: ServerResponse) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.from(chunk));
        }
        requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));

        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        response.write(streamChunk({ role: "assistant", content: "hello" }));
        response.write(streamChunk({ content: " from pi" }));
        response.write(streamChunk({}, "stop"));
        response.end("data: [DONE]\n\n");
      },
    );

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as AddressInfo;
      process.env.LM_STUDIO_BASE_URL_FOR_TESTING = `http://127.0.0.1:${address.port}`;

      const model = await resolveDyadModel({
        provider: "lmstudio",
        name: "local-model",
      });
      const result = await getPiModels()
        .streamSimple(
          model,
          {
            messages: [
              { role: "user", content: "Say hello", timestamp: Date.now() },
            ],
          },
          { maxTokens: 32 },
        )
        .result();

      expect(result.errorMessage).toBeUndefined();
      expect(result.stopReason).toBe("stop");
      expect(result.content).toEqual([{ type: "text", text: "hello from pi" }]);
      expect(requestBody).toMatchObject({
        model: "local-model",
        stream: true,
        messages: [{ role: "user", content: "Say hello" }],
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("streams a real request through a database-defined custom provider", async () => {
    let authorization: string | undefined;
    const server = createServer(
      async (request: IncomingMessage, response: ServerResponse) => {
        authorization = request.headers.authorization;
        for await (const _chunk of request) {
          // Drain the request body before responding.
        }

        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        response.write(
          streamChunk({ role: "assistant", content: "custom ok" }),
        );
        response.write(streamChunk({}, "stop"));
        response.end("data: [DONE]\n\n");
      },
    );

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as AddressInfo;
      const model = await resolveDyadModel(
        { provider: "custom::integration", name: "custom-model" },
        async () => ({
          id: "custom::integration",
          name: "Integration provider",
          apiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
          type: "custom",
        }),
      );

      const result = await getPiModels()
        .streamSimple(model, {
          messages: [
            { role: "user", content: "Use custom", timestamp: Date.now() },
          ],
        })
        .result();

      expect(result.stopReason).toBe("stop");
      expect(result.content).toEqual([{ type: "text", text: "custom ok" }]);
      expect(authorization).toBe("Bearer not-required");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("streams through the real pi Azure Responses implementation", async () => {
    const handler = createResponsesHandler(".");
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      (request as IncomingMessage & { body: unknown }).body = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      );
      await handler(request as never, response as never);
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as AddressInfo;
      const model = await resolveDyadModel({
        provider: "azure",
        name: "gpt-5.1",
      });
      const result = await getPiModels()
        .streamSimple(
          model,
          {
            messages: [
              {
                role: "user",
                content: "Azure integration",
                timestamp: Date.now(),
              },
            ],
          },
          {
            apiKey: "azure-test-key",
            env: {
              AZURE_OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/openai/v1`,
            },
          },
        )
        .result();

      expect(result.stopReason).toBe("stop");
      expect(result.content).toEqual([
        expect.objectContaining({
          type: "text",
          text: "This is a fake response.",
        }),
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("streams through the real pi Google Vertex implementation", async () => {
    let requestUrl: string | undefined;
    const server = createServer(
      async (request: IncomingMessage, response: ServerResponse) => {
        requestUrl = request.url;
        for await (const _chunk of request) {
          // Drain the request body before responding.
        }
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        response.end(
          `data: ${JSON.stringify({
            responseId: "vertex-response",
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "vertex ok" }],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 2,
              candidatesTokenCount: 2,
              totalTokenCount: 4,
            },
          })}\n\n`,
        );
      },
    );

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as AddressInfo;
      const catalogModel = await resolveDyadModel({
        provider: "vertex",
        name: "gemini-2.5-flash",
      });
      const model = {
        ...catalogModel,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      };
      const result = await getPiModels()
        .streamSimple(
          model,
          {
            messages: [
              {
                role: "user",
                content: "Vertex integration",
                timestamp: Date.now(),
              },
            ],
          },
          { apiKey: "vertex-test-key" },
        )
        .result();

      expect(result.stopReason).toBe("stop");
      expect(result.content).toEqual([{ type: "text", text: "vertex ok" }]);
      expect(requestUrl).toContain(
        "/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent",
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

function streamChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-pi-runtime",
    object: "chat.completion.chunk",
    created: 1,
    model: "local-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}
