import express from "express";
import { createServer } from "http";
import cors from "cors";
import crypto from "node:crypto";
import { createChatCompletionHandler } from "./chatCompletionHandler";
import { createResponsesHandler } from "./responsesHandler";
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
  handleRepoCollaborators,
} from "./githubHandler";

// Create Express app
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Allow port to be specified via command line argument or environment variable
// Usage: node dist/index.js --port=3501 OR PORT=3501 node dist/index.js
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const PORT = portArg
  ? parseInt(portArg.split("=")[1], 10)
  : parseInt(process.env.PORT || "3500", 10);
if (isNaN(PORT)) {
  throw new Error(`Invalid port: ${portArg || process.env.PORT}`);
}

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

export const CANNED_MESSAGE = `
  <dyad-write path="file1.txt">
  A file (2)
  </dyad-write>
  More
  EOM`;

type FakeCloudSandbox = {
  id: string;
  files: Record<string, Buffer>;
  createdAt: number;
  previewAuthToken: string;
  syncRevision: number;
  initialSyncCompleted: boolean;
  lastActiveAt: number;
  lastSuccessfulSyncAt: number | null;
};

const cloudSandboxes = new Map<string, FakeCloudSandbox>();

function getFakeCloudPreviewUrl(sandboxId: string) {
  return `http://localhost:${PORT}/cloud-preview/${sandboxId}`;
}

function createServiceResponse<T>(responseObject: T) {
  return {
    success: true,
    message: "ok",
    responseObject,
    statusCode: 200,
  };
}

async function parseMultipartFormData(req: express.Request) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const request = new Request("http://localhost/fake-cloud-upload", {
    method: req.method,
    headers,
    body: Buffer.concat(chunks),
  });

  return request.formData();
}

async function parseCloudSandboxUpload(req: express.Request) {
  if (!req.is("multipart/form-data")) {
    return {
      replaceAll: req.body.replaceAll === true,
      deletedFiles: Array.isArray(req.body.deletedFiles)
        ? req.body.deletedFiles
        : [],
      files: Object.fromEntries(
        Object.entries(req.body.files ?? {}).map(([filePath, content]) => [
          filePath,
          Buffer.from(String(content), "utf8"),
        ]),
      ) as Record<string, Buffer>,
    };
  }

  const formData = await parseMultipartFormData(req);
  const manifestValue = formData.get("manifest");

  if (typeof manifestValue !== "string") {
    throw new Error("Expected multipart sandbox upload manifest.");
  }

  const manifest = JSON.parse(manifestValue) as {
    replaceAll: boolean;
    deletedFiles?: string[];
    files?: Array<{ path: string; fieldName: string }>;
  };
  const files: Record<string, Buffer> = {};

  for (const entry of manifest.files ?? []) {
    const filePart = formData.get(entry.fieldName);
    if (!(filePart instanceof File)) {
      throw new Error(`Expected multipart file part ${entry.fieldName}.`);
    }

    files[entry.path] = Buffer.from(await filePart.arrayBuffer());
  }

  return {
    replaceAll: manifest.replaceAll === true,
    deletedFiles: manifest.deletedFiles ?? [],
    files,
  };
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getSandboxPreviewHtml(sandbox: FakeCloudSandbox) {
  const interestingSource =
    sandbox.files["src/App.tsx"]?.toString("utf8") ??
    sandbox.files["src/App.jsx"]?.toString("utf8") ??
    sandbox.files["app/page.tsx"]?.toString("utf8") ??
    sandbox.files["index.html"]?.toString("utf8") ??
    "";

  const fileList = Object.keys(sandbox.files)
    .sort()
    .slice(0, 12)
    .map((file) => `<li>${escapeHtml(file)}</li>`)
    .join("");
  const snapshotHasher = crypto.createHash("sha1");
  for (const [filePath, content] of Object.entries(sandbox.files).sort(
    ([leftPath], [rightPath]) => leftPath.localeCompare(rightPath),
  )) {
    snapshotHasher.update(filePath);
    snapshotHasher.update("\0");
    snapshotHasher.update(content);
    snapshotHasher.update("\0");
  }
  const snapshotDigest = snapshotHasher.digest("hex").slice(0, 12);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Cloud Sandbox Preview</title>
  </head>
  <body>
    <main>
      <h1>Cloud Sandbox Preview</h1>
      <p data-testid="cloud-sandbox-id">Sandbox: ${escapeHtml(sandbox.id)}</p>
      <p>Uploaded files: ${Object.keys(sandbox.files).length}</p>
      <p data-testid="cloud-snapshot-digest">Snapshot digest: ${snapshotDigest}</p>
      <ul>${fileList}</ul>
      <pre>${escapeHtml(interestingSource.slice(0, 1500))}</pre>
    </main>
  </body>
</html>`;
}

app.get("/health", (req, res) => {
  res.send("OK");
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
    aliases: [
      {
        id: "dyad/theme-generator/google",
        resolvedModel: {
          providerId: "google",
          apiName: "gemini-3.1-pro-preview",
        },
        displayName: "Google Remote",
        purpose: "theme-generation",
      },
      {
        id: "dyad/theme-generator/anthropic",
        resolvedModel: {
          providerId: "anthropic",
          apiName: "claude-sonnet-4-6",
        },
        displayName: "Anthropic Remote",
        purpose: "theme-generation",
      },
      {
        id: "dyad/theme-generator/openai",
        resolvedModel: {
          providerId: "openai",
          apiName: "gpt-5.2",
        },
        displayName: "OpenAI Remote",
        purpose: "theme-generation",
      },
      {
        id: "dyad/auto/openai",
        resolvedModel: {
          providerId: "openai",
          apiName: "gpt-5.2",
        },
        purpose: "auto-mode",
      },
      {
        id: "dyad/auto/anthropic",
        resolvedModel: {
          providerId: "anthropic",
          apiName: "claude-sonnet-4-6",
        },
        purpose: "auto-mode",
      },
      {
        id: "dyad/auto/google",
        resolvedModel: {
          providerId: "google",
          apiName: "gemini-3.1-pro-preview",
        },
        purpose: "auto-mode",
      },
      {
        id: "dyad/help-bot/default",
        resolvedModel: {
          providerId: "openai",
          apiName: "gpt-5.2",
        },
        purpose: "help-bot",
      },
    ],
    curatedSelections: {
      themeGenerationOptions: [
        {
          id: "dyad/theme-generator/google",
          label: "Google Remote",
        },
        {
          id: "dyad/theme-generator/anthropic",
          label: "Anthropic Remote",
        },
        {
          id: "dyad/theme-generator/openai",
          label: "OpenAI Remote",
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
  console.log("* Sending fake Ollama models");
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
  console.log("* Sending fake LM Studio models");
  res.json(lmStudioModels);
});

["lmstudio", "gateway", "engine", "ollama", "azure"].forEach((provider) => {
  app.post(
    `/${provider}/v1/chat/completions`,
    createChatCompletionHandler(provider),
  );
  // Also add responses API endpoints for each provider
  app.post(`/${provider}/v1/responses`, createResponsesHandler(provider));
});

// Azure-specific endpoints (Azure client uses different URL patterns)
app.post("/azure/chat/completions", createChatCompletionHandler("azure"));
app.post(
  "/azure/openai/deployments/:deploymentId/chat/completions",
  createChatCompletionHandler("azure"),
);

// Default test provider handler:
app.post("/v1/chat/completions", createChatCompletionHandler("."));
app.post("/v1/responses", createResponsesHandler("."));

// GitHub API Mock Endpoints
console.log("Setting up GitHub mock endpoints");

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

// GitHub Git endpoints - intercept all paths with /github/git prefix
app.all("/github/git/*", handleGitPush);

// Dyad Engine code-search endpoint for code_search tool
app.post("/engine/v1/tools/code-search", (req, res) => {
  const { query, filesContext } = req.body;
  console.log(
    `* code-search: "${query}" - searching ${filesContext?.length || 0} files`,
  );

  try {
    // Return mock relevant files based on the files provided
    // For testing, return the first few files that exist in the context
    const relevantFiles = (filesContext || [])
      .slice(0, 3)
      .map((f: { path: string }) => f.path);

    res.json({ relevantFiles });
  } catch (error) {
    console.error(`* code-search error:`, error);
    res.status(400).json({ error: String(error) });
  }
});

// Dyad Engine image generation endpoint for generate_image tool
app.post("/engine/v1/images/generations", (req, res) => {
  const { prompt, model } = req.body;
  console.log(
    `* images/generations: model=${model}, prompt="${prompt?.slice(0, 50)}..."`,
  );

  try {
    // Return a small 1x1 white PNG as base64 for testing
    const TINY_PNG_B64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    res.json({
      created: Math.floor(Date.now() / 1000),
      data: [
        {
          b64_json: TINY_PNG_B64,
        },
      ],
    });
  } catch (error) {
    console.error(`* images/generations error:`, error);
    res.status(400).json({ error: String(error) });
  }
});

// Dyad Engine web-crawl endpoint for web_fetch tool
app.post("/engine/v1/tools/web-crawl", (req, res) => {
  const { url, markdownOnly } = req.body;
  console.log(`* web-crawl: url="${url}", markdownOnly=${markdownOnly}`);

  try {
    res.json({
      rootUrl: url,
      markdown: `# Page content from ${url}`,
      pages: [
        {
          url,
          markdown: `# Page content from ${url}\n\nThis is the fetched content of the web page.\n\n- Item 1\n- Item 2\n- Item 3`,
        },
      ],
    });
  } catch (error) {
    console.error(`* web-crawl error:`, error);
    res.status(400).json({ error: String(error) });
  }
});

app.post("/engine/v1/sandboxes", (_req, res) => {
  const sandboxId = `sandbox-${Date.now()}-${Math.round(Math.random() * 1000)}`;
  const previewAuthToken = `fake-preview-auth-token-${sandboxId}`;
  const createdAt = Date.now();
  cloudSandboxes.set(sandboxId, {
    id: sandboxId,
    files: {},
    createdAt,
    previewAuthToken,
    syncRevision: 0,
    initialSyncCompleted: false,
    lastActiveAt: createdAt,
    lastSuccessfulSyncAt: null,
  });

  res.json({
    sandboxId,
    previewUrl: getFakeCloudPreviewUrl(sandboxId),
    previewAuthToken,
  });
});

app.delete("/engine/v1/sandboxes/:sandboxId", (req, res) => {
  cloudSandboxes.delete(req.params.sandboxId);
  res.status(204).end();
});

app.post("/engine/v1/sandboxes/:sandboxId/files", async (req, res) => {
  const sandbox = cloudSandboxes.get(req.params.sandboxId);
  if (!sandbox) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }

  const upload = await parseCloudSandboxUpload(req);

  console.log(
    `[fake-cloud] upload sandbox=${sandbox.id} replaceAll=${String(upload.replaceAll)} fileCount=${Object.keys(upload.files).length} deletedCount=${upload.deletedFiles.length}`,
  );

  sandbox.lastActiveAt = Date.now();
  sandbox.lastSuccessfulSyncAt = Date.now();
  sandbox.initialSyncCompleted = true;
  sandbox.syncRevision += 1;
  sandbox.files = upload.replaceAll
    ? { ...upload.files }
    : {
        ...sandbox.files,
        ...upload.files,
      };

  for (const deletedFile of upload.deletedFiles) {
    delete sandbox.files[deletedFile];
  }

  res.json({
    previewUrl: getFakeCloudPreviewUrl(sandbox.id),
    previewAuthToken: sandbox.previewAuthToken,
  });
});

app.post("/engine/v1/sandboxes/reconcile", (_req, res) => {
  res.json({
    reconciledSandboxIds: [],
  });
});

app.get("/engine/v1/sandboxes/:sandboxId/status", (req, res) => {
  const sandbox = cloudSandboxes.get(req.params.sandboxId);
  if (!sandbox) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }

  sandbox.lastActiveAt = Date.now();

  res.json(
    createServiceResponse({
      sandboxId: sandbox.id,
      status: "running",
      previewUrl: getFakeCloudPreviewUrl(sandbox.id),
      previewAuthToken: sandbox.previewAuthToken,
      previewPort: PORT,
      syncRevision: sandbox.syncRevision,
      initialSyncCompleted: sandbox.initialSyncCompleted,
      appStatus: "running",
      syncAgentHealthy: true,
      createdAt: new Date(sandbox.createdAt).toISOString(),
      lastActiveAt: new Date(sandbox.lastActiveAt).toISOString(),
      lastSuccessfulSyncAt: sandbox.lastSuccessfulSyncAt
        ? new Date(sandbox.lastSuccessfulSyncAt).toISOString()
        : null,
      expiresAt: new Date(sandbox.lastActiveAt + 10 * 60 * 1000).toISOString(),
      billingState: "active",
      billingStartedAt: new Date(sandbox.createdAt).toISOString(),
      billingLockedAt: null,
      lastChargedAt: null,
      nextChargeAt: new Date(sandbox.createdAt + 60 * 1000).toISOString(),
      billingSlicesCharged: 0,
      creditsCharged: 0,
      terminationReason: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    }),
  );
});

app.post("/engine/v1/sandboxes/:sandboxId/restart", (req, res) => {
  const sandbox = cloudSandboxes.get(req.params.sandboxId);
  if (!sandbox) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }

  sandbox.lastActiveAt = Date.now();

  res.json({
    previewUrl: getFakeCloudPreviewUrl(sandbox.id),
    previewAuthToken: sandbox.previewAuthToken,
  });
});

app.post("/engine/v1/sandboxes/:sandboxId/share-links", (req, res) => {
  const sandbox = cloudSandboxes.get(req.params.sandboxId);
  if (!sandbox) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }

  const expiresInSeconds =
    typeof req.body.expiresInSeconds === "number"
      ? req.body.expiresInSeconds
      : 600;
  const shareLinkId = `share-link-${sandbox.id}`;

  res.json(
    createServiceResponse({
      sandboxId: sandbox.id,
      shareLinkId,
      url: `${getFakeCloudPreviewUrl(sandbox.id)}?share=${shareLinkId}`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    }),
  );
});

app.get("/engine/v1/sandboxes/:sandboxId/logs", (req, res) => {
  const sandbox = cloudSandboxes.get(req.params.sandboxId);
  if (!sandbox) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const messages = [
    "Creating sandbox...",
    "Installing dependencies...",
    `Starting preview for ${sandbox.id}...`,
  ];

  messages.forEach((message) => {
    res.write(`data: ${JSON.stringify({ message })}\n\n`);
  });
  res.write("data: [DONE]\n\n");
  res.end();
});

app.get("/cloud-preview/:sandboxId", (req, res) => {
  const sandbox = cloudSandboxes.get(req.params.sandboxId);
  if (!sandbox) {
    res.status(404).send("Sandbox not found");
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(getSandboxPreviewHtml(sandbox));
});

// Start the server
const server = createServer(app);
server.listen(PORT, () => {
  console.log(`Fake LLM server running on http://localhost:${PORT}`);
});

// Handle SIGINT (Ctrl+C)
process.on("SIGINT", () => {
  console.log("Shutting down fake LLM server");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
