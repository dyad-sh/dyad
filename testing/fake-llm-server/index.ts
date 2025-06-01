import express from "express";
import { createServer } from "http";
import cors from "cors";
import fs from "fs";
import path from "path";

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3500;

// Helper function to create OpenAI-like streaming response chunks
function createStreamChunk(
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

const CANNED_MESSAGE = `
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

let globalCounter = 0;

// Handle POST requests to /v1/chat/completions
app.post("/v1/chat/completions", (req, res) => {
  const { stream = false, messages = [] } = req.body;
  console.log("* Received messages", messages);

  // Check if the last message contains "[429]" to simulate rate limiting
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.content === "[429]") {
    return res.status(429).json({
      error: {
        message: "Too many requests. Please try again later.",
        type: "rate_limit_error",
        param: null,
        code: "rate_limit_exceeded",
      },
    });
  }

  let messageContent = CANNED_MESSAGE;

  // Check if the last message is "[dump]" to write messages to file and return path
  if (lastMessage && lastMessage.content === "[dump]") {
    const timestamp = Date.now();
    const generatedDir = path.join(__dirname, "generated");

    // Create generated directory if it doesn't exist
    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }

    const dumpFilePath = path.join(generatedDir, `${timestamp}.json`);

    try {
      fs.writeFileSync(
        dumpFilePath,
        JSON.stringify(messages, null, 2),
        "utf-8",
      );
      console.log(`* Dumped messages to: ${dumpFilePath}`);
      messageContent = `[[dyad-dump-path=${dumpFilePath}]]`;
    } catch (error) {
      console.error(`* Error writing dump file: ${error}`);
      messageContent = `Error: Could not write dump file: ${error}`;
    }
  }

  if (lastMessage && lastMessage.content === "[increment]") {
    globalCounter++;
    messageContent = `counter=${globalCounter}`;
  }

  // Check if the last message starts with "tc=" to load test case file
  if (
    lastMessage &&
    lastMessage.content &&
    lastMessage.content.startsWith("tc=")
  ) {
    const testCaseName = lastMessage.content.slice(3); // Remove "tc=" prefix
    const testFilePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "e2e-tests",
      "fixtures",
      `${testCaseName}.md`,
    );

    try {
      if (fs.existsSync(testFilePath)) {
        messageContent = fs.readFileSync(testFilePath, "utf-8");
        console.log(`* Loaded test case: ${testCaseName}`);
      } else {
        console.log(`* Test case file not found: ${testFilePath}`);
        messageContent = `Error: Test case file not found: ${testCaseName}.md`;
      }
    } catch (error) {
      console.error(`* Error reading test case file: ${error}`);
      messageContent = `Error: Could not read test case file: ${testCaseName}.md`;
    }
  }

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
            content: messageContent,
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

  // Split the message into characters to simulate streaming
  const message = messageContent;
  const messageChars = message.split("");

  // Stream each character with a delay
  let index = 0;
  const batchSize = 8;

  // Send role first
  res.write(createStreamChunk("", "assistant"));

  const interval = setInterval(() => {
    if (index < messageChars.length) {
      // Get the next batch of characters (up to batchSize)
      const batch = messageChars.slice(index, index + batchSize).join("");
      res.write(createStreamChunk(batch));
      index += batchSize;
    } else {
      // Send the final chunk
      res.write(createStreamChunk("", "assistant", true));
      clearInterval(interval);
      res.end();
    }
  }, 1);
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
