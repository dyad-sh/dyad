"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const cors_1 = __importDefault(require("cors"));
// Create Express app
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const PORT = 3500;
// Helper function to create OpenAI-like streaming response chunks
function createStreamChunk(content, role = "assistant", isLast = false) {
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
// Handle POST requests to /v1/chat/completions
app.post("/v1/chat/completions", (req, res) => {
  const { stream = false } = req.body;
  // Non-streaming response
  if (!stream) {
    return res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "fake-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "hello world",
          },
          finish_reason: "stop",
        },
      ],
    });
  }
  // Streaming response
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Split the "hello world" message into characters to simulate streaming
  const message = "hello world";
  const messageChars = message.split("");
  // Stream each character with a delay
  let index = 0;
  // Send role first
  res.write(createStreamChunk("", "assistant"));
  const interval = setInterval(() => {
    if (index < messageChars.length) {
      res.write(createStreamChunk(messageChars[index]));
      index++;
    } else {
      // Send the final chunk
      res.write(createStreamChunk("", "assistant", true));
      clearInterval(interval);
      res.end();
    }
  }, 100);
});
// Start the server
const server = (0, http_1.createServer)(app);
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
