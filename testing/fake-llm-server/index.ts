import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
import cors from "cors";
import { createChatCompletionHandler } from "./chatCompletionHandler";
import { createResponsesHandler } from "./responsesHandler";
import { createAnthropicMessagesHandler } from "./anthropicMessagesHandler";
import { fakeLlmLog } from "./log";
import {
  handleDeviceCode,
  handleAccessToken,
  handleUser,
  handleUserEmails,
  handleUserRepos,
  handleRepo,
  handleRepoBranches,
  handleOrgRepos,
  handleGitPush,
  handleGetPushEvents,
  handleClearPushEvents,
  handleResetRepos,
  handleRepoCollaborators,
} from "./githubHandler";

// Helper function to create OpenAI-like streaming response chunks
export function createStreamChunk(
  content: string,
  role: string = "assistant",
  isLast: boolean = false,
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  },
) {
  const chunk: any = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fake-model",
    choices: [
      {
        index: 0,
        delta: isLast ? {} : { content, role },
        finish_reason: isLast ? "stop" : null,
      },
    ],
  };

  // Add usage info to the final chunk if provided
  if (isLast && usage) {
    chunk.usage = usage;
  }

  return `data: ${JSON.stringify(chunk)}\n\n${isLast ? "data: [DONE]\n\n" : ""}`;
}

export const CANNED_MESSAGE = "This is a fake response.";

/**
 * Builds the fake-LLM Express app with every route mounted. The app does NOT
 * listen; the caller (the CLI entry below, or the vitest chat-flow harness)
 * decides when/where to listen.
 */
export function createFakeLlmApp(_getPort: () => number) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.get("/health", (req, res) => {
    res.send("OK");
  });

  app.get("/api/default-approve-builds.txt", (req, res) => {
    res
      .type("text/plain")
      .send(
        [
          "# dyad-default-allow-builds-schema=v1",
          "# dyad-default-allow-builds-data-version=2026-05-21.2",
          "# dyad-default-allow-builds-channel=remote",
          "@swc/core",
          "esbuild",
          "sharp",
          "",
        ].join("\n"),
      );
  });

  app.get("/api/language-model-catalog", (req, res) => {
    res.json({
      version: "e2e-test-catalog-v1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      providers: [
        {
          id: "openai",
          displayName: "OpenAI",
          type: "cloud",
        },
        {
          id: "anthropic",
          displayName: "Anthropic",
          type: "cloud",
        },
        {
          id: "google",
          displayName: "Google",
          type: "cloud",
          hasFreeTier: true,
          gatewayPrefix: "gemini/",
        },
      ],
      modelsByProvider: {
        openai: [
          {
            apiName: "gpt-5.2",
            displayName: "GPT 5.2",
            description: "Remote catalog OpenAI model",
          },
          {
            apiName: "gpt-5",
            temperature: 1,
            displayName: "GPT 5",
            description: "Remote catalog OpenAI model",
          },
          {
            apiName: "gpt-5.2-remote-only",
            displayName: "GPT 5.2 Remote Only",
            description: "Remote-only catalog OpenAI model for E2E coverage",
          },
        ],
        anthropic: [
          {
            apiName: "claude-opus-4-6",
            displayName: "Claude Opus 4.6",
            description: "Remote catalog Anthropic model",
          },
          {
            apiName: "claude-sonnet-4-6",
            displayName: "Claude Sonnet 4.6",
            description: "Remote catalog Anthropic model",
          },
          {
            apiName: "claude-opus-4-5",
            displayName: "Claude Opus 4.5",
            description: "Remote catalog Anthropic model",
            maxOutputTokens: 32_000,
          },
          {
            apiName: "claude-sonnet-4-20250514",
            displayName: "Claude Sonnet 4",
            description: "Remote catalog Anthropic model",
            maxOutputTokens: 32_000,
          },
        ],
        google: [
          {
            apiName: "gemini-3.1-pro-preview",
            displayName: "Gemini 3.1 Pro (Preview)",
            description: "Remote catalog Google model",
          },
          {
            apiName: "gemini-2.5-pro",
            displayName: "Gemini 2.5 Pro",
            description: "Remote catalog Google model",
            maxOutputTokens: 65_535,
          },
        ],
      },
    });
  });

  // Ollama-specific endpoints
  app.get("/ollama/api/tags", (req, res) => {
    const ollamaModels = {
      models: [
        {
          name: "testollama",
          modified_at: "2024-05-01T10:00:00.000Z",
          size: 4700000000,
          digest: "abcdef123456",
          details: {
            format: "gguf",
            family: "llama",
            families: ["llama"],
            parameter_size: "8B",
            quantization_level: "Q4_0",
          },
        },
        {
          name: "codellama:7b",
          modified_at: "2024-04-25T12:30:00.000Z",
          size: 3800000000,
          digest: "fedcba654321",
          details: {
            format: "gguf",
            family: "llama",
            families: ["llama", "codellama"],
            parameter_size: "7B",
            quantization_level: "Q5_K_M",
          },
        },
      ],
    };
    fakeLlmLog("* Sending fake Ollama models");
    res.json(ollamaModels);
  });

  // LM Studio specific endpoints
  app.get("/lmstudio/api/v0/models", (req, res) => {
    const lmStudioModels = {
      data: [
        {
          type: "llm",
          id: "lmstudio-model-1",
          object: "model",
          publisher: "lmstudio",
          state: "loaded",
          max_context_length: 4096,
          quantization: "Q4_0",
          compatibility_type: "gguf",
          arch: "llama",
        },
        {
          type: "llm",
          id: "lmstudio-model-2-chat",
          object: "model",
          publisher: "lmstudio",
          state: "not-loaded",
          max_context_length: 8192,
          quantization: "Q5_K_M",
          compatibility_type: "gguf",
          arch: "mixtral",
        },
        {
          type: "embedding", // Should be filtered out by client
          id: "lmstudio-embedding-model",
          object: "model",
          publisher: "lmstudio",
          state: "loaded",
          max_context_length: 2048,
          quantization: "F16",
          compatibility_type: "gguf",
          arch: "bert",
        },
      ],
    };
    fakeLlmLog("* Sending fake LM Studio models");
    res.json(lmStudioModels);
  });

  app.post(
    /^\/google\/v1beta\/models\/.+:(streamGenerateContent|generateContent)/,
    (req, res) => {
      const apiKeyHeader = req.headers["x-goog-api-key"];
      const apiKey =
        typeof apiKeyHeader === "string"
          ? apiKeyHeader
          : Array.isArray(apiKeyHeader)
            ? apiKeyHeader.join(",")
            : "";

      if (/invalid/i.test(apiKey)) {
        return res.status(401).json({
          error: {
            code: 401,
            message: "Invalid API key",
            status: "UNAUTHENTICATED",
          },
        });
      }

      const response = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "5" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 1,
          totalTokenCount: 9,
        },
      };

      if (req.path.includes("streamGenerateContent")) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.write(`data: ${JSON.stringify(response)}\n\n`);
        res.end();
        return;
      }

      res.json(response);
    },
  );

  ["lmstudio", "ollama", "azure", "openrouter"].forEach((provider) => {
    app.post(
      `/${provider}/v1/chat/completions`,
      createChatCompletionHandler(provider),
    );
    // Also add responses API endpoints for each provider
    app.post(`/${provider}/v1/responses`, createResponsesHandler(provider));
    app.post(
      `/${provider}/v1/messages`,
      createAnthropicMessagesHandler(provider),
    );
  });

  // Azure-specific endpoints (Azure client uses different URL patterns)
  app.post("/azure/chat/completions", createChatCompletionHandler("azure"));
  app.post("/azure/responses", createResponsesHandler("azure"));
  app.post(
    "/azure/openai/deployments/:deploymentId/chat/completions",
    createChatCompletionHandler("azure"),
  );

  // Default test provider handler:
  app.post("/v1/chat/completions", createChatCompletionHandler("."));
  app.post("/v1/responses", createResponsesHandler("."));
  app.post("/v1/messages", createAnthropicMessagesHandler("."));

  app.post("/images/v1/chat/completions", (req, res) => {
    const { model } = req.body;
    fakeLlmLog(`* image generation: model=${model}`);

    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    res.json({
      id: "image-response",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
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
                  url: `data:image/png;base64,${tinyPngBase64}`,
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
    });
  });

  // GitHub API Mock Endpoints
  fakeLlmLog("Setting up GitHub mock endpoints");

  // GitHub OAuth Device Flow
  app.post("/github/login/device/code", handleDeviceCode);
  app.post("/github/login/oauth/access_token", handleAccessToken);

  // GitHub API endpoints
  app.get("/github/api/user", handleUser);
  app.get("/github/api/user/emails", handleUserEmails);
  app.get("/github/api/user/repos", handleUserRepos);
  app.post("/github/api/user/repos", handleUserRepos);
  app.get("/github/api/repos/:owner/:repo", handleRepo);
  app.get("/github/api/repos/:owner/:repo/branches", handleRepoBranches);
  app.get(
    "/github/api/repos/:owner/:repo/collaborators",
    handleRepoCollaborators,
  );
  app.put(
    "/github/api/repos/:owner/:repo/collaborators/:username",
    handleRepoCollaborators,
  );
  app.delete(
    "/github/api/repos/:owner/:repo/collaborators/:username",
    handleRepoCollaborators,
  );
  app.post("/github/api/orgs/:org/repos", handleOrgRepos);

  // GitHub test endpoints for verifying push operations
  app.get("/github/api/test/push-events", handleGetPushEvents);
  app.post("/github/api/test/clear-push-events", handleClearPushEvents);
  app.post("/github/api/test/reset-repos", handleResetRepos);

  // GitHub Git endpoints - intercept all paths with /github/git prefix
  app.all("/github/git/*", handleGitPush);

  app.get("/test-image.png", (_req, res) => {
    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    res.type("png").send(Buffer.from(tinyPngBase64, "base64"));
  });

  return app;
}

export interface FakeLlmServerHandle {
  server: ReturnType<typeof createServer>;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Starts the fake-LLM server on `port` (default 0 = ephemeral) bound to
 * `host` (default 127.0.0.1). Resolves once the socket is listening, with the
 * actually-bound port. Used by the vitest chat-flow harness for in-process,
 * parallel-safe fixtures.
 */
export function startFakeLlmServer({
  port = 0,
  host = "127.0.0.1",
}: { port?: number; host?: string } = {}): Promise<FakeLlmServerHandle> {
  let boundPort = port;
  const app = createFakeLlmApp(() => boundPort);
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      boundPort = (server.address() as AddressInfo).port;
      resolve({
        server,
        port: boundPort,
        url: `http://${host}:${boundPort}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

// CLI entry: preserve the exact prior behaviour for the Playwright webServer
// command (`npm run build && npm start -- --port=N`). Only runs when this file
// is the process entry point, never when imported by the harness.
if (require.main === module) {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  const PORT = portArg
    ? parseInt(portArg.split("=")[1], 10)
    : parseInt(process.env.PORT || "3500", 10);
  if (isNaN(PORT)) {
    throw new Error(`Invalid port: ${portArg || process.env.PORT}`);
  }

  // Bind the IPv6 wildcard with dual-stack enabled (Node's default) so both
  // localhost resolutions, ::1 and 127.0.0.1, reach the same E2E server.
  startFakeLlmServer({ port: PORT, host: "::" })
    .then((handle) => {
      console.log(`Fake LLM server running on http://localhost:${handle.port}`);

      // Handle SIGINT (Ctrl+C)
      process.on("SIGINT", () => {
        console.log("Shutting down fake LLM server");
        handle.close().then(() => {
          console.log("Server closed");
          process.exit(0);
        });
      });
    })
    .catch((err) => {
      console.error("Failed to start fake LLM server", err);
      process.exit(1);
    });
}
