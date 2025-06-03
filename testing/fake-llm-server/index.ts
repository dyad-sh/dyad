import express from "express";
import { createServer } from "http";
import cors from "cors";
import { createChatCompletionHandler } from "./chatCompletionHandler";

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
) {
  const chunk = {
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

  return `data: ${JSON.stringify(chunk)}\n\n${isLast ? "data: [DONE]\n\n" : ""}`;
}

export const CANNED_MESSAGE = `
  <think>
  \`<dyad-write>\`:
  I'll think about the problem and write a bug report.

  <dyad-write>

  <dyad-write path="file1.txt">
  Fake dyad write
  </dyad-write>
  </think>
  
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

app.post("/ollama/chat", (req, res) => {
  // Tell the client we're going to stream NDJSON
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");

  // Chunk #1 – partial answer
  const firstChunk = {
    model: "llama3.2",
    created_at: "2023-08-04T08:52:19.385406455-07:00",
    message: {
      role: "assistant",
      content: "ollamachunk",
      images: null,
    },
    done: false,
  };

  // Chunk #2 – final answer + metrics
  const secondChunk = {
    model: "llama3.2",
    created_at: "2023-08-04T19:22:45.499127Z",
    message: {
      role: "assistant",
      content: "",
    },
    done: true,
    total_duration: 4883583458,
    load_duration: 1334875,
    prompt_eval_count: 26,
    prompt_eval_duration: 342546000,
    eval_count: 282,
    eval_duration: 4535599000,
  };

  // Send the first object right away
  res.write(JSON.stringify(firstChunk) + "\n");
  res.write(JSON.stringify(firstChunk) + "\n");

  // …and the second one a moment later to mimic streaming
  setTimeout(() => {
    res.write(JSON.stringify(secondChunk) + "\n");
    res.end(); // Close the HTTP stream
  }, 300); // 300 ms delay – tweak as you like
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

["lmstudio", "gateway", "engine"].forEach((provider) => {
  app.post(
    `/${provider}/v1/chat/completions`,
    createChatCompletionHandler(provider),
  );
});

// Default test provider handler:
app.post("/v1/chat/completions", createChatCompletionHandler("."));

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
