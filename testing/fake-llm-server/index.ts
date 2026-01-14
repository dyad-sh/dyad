import express from "express";
import { createServer } from "http";
import cors from "cors";
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

const PORT = 3500;

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

app.get("/health", (req, res) => {
  res.send("OK");
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

// Dyad Engine turbo-file-edit endpoint for edit_file tool
app.post("/engine/v1/tools/turbo-file-edit", (req, res) => {
  const { path: filePath, description } = req.body;
  console.log(
    `* turbo-file-edit: ${filePath} - ${description || "no description"}`,
  );

  try {
    res.json({ result: "TURBO EDITED filePath" });
  } catch (error) {
    console.error(`* turbo-file-edit error:`, error);
    res.status(400).json({ error: String(error) });
  }
});

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
