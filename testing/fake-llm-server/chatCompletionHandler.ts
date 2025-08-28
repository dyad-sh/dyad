import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { CANNED_MESSAGE, createStreamChunk } from ".";

let globalCounter = 0;

export const createChatCompletionHandler =
  (prefix: string) => (req: Request, res: Response) => {
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

    if (
      lastMessage &&
      Array.isArray(lastMessage.content) &&
      lastMessage.content.some(
        (part: { type: string; text: string }) =>
          part.type === "text" &&
          part.text.includes("[[UPLOAD_IMAGE_TO_CODEBASE]]"),
      )
    ) {
      messageContent = `Uploading image to codebase
<dyad-write path="new/image/file.png" description="Uploaded image to codebase">
DYAD_ATTACHMENT_0
</dyad-write>
`;
      messageContent += "\n\n" + generateDump(req);
    }

    // TS auto-fix prefixes
    if (
      lastMessage &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.startsWith(
        "Fix these 2 TypeScript compile-time error",
      )
    ) {
      // Fix errors in create-ts-errors.md and introduce a new error
      messageContent = `
<dyad-write path="src/bad-file.ts" description="Fix 2 errors and introduce a new error.">
// Import doesn't exist
// import NonExistentClass from 'non-existent-class';


const x = new Object();
x.nonExistentMethod2();
</dyad-write>

      `;
    }
    if (
      lastMessage &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.startsWith(
        "Fix these 1 TypeScript compile-time error",
      )
    ) {
      // Fix errors in create-ts-errors.md and introduce a new error
      messageContent = `
<dyad-write path="src/bad-file.ts" description="Fix remaining error.">
// Import doesn't exist
// import NonExistentClass from 'non-existent-class';


const x = new Object();
x.toString(); // replaced with existing method
</dyad-write>

      `;
    }

    if (
      lastMessage &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.includes("TypeScript compile-time error")
    ) {
      messageContent += "\n\n" + generateDump(req);
    }
    if (
      lastMessage &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.startsWith("Fix error: Error Line 6 error")
    ) {
      messageContent = `
      Fixing the error...
      <dyad-write path="src/pages/Index.tsx">
      

import { MadeWithDyad } from "@/components/made-with-dyad";

const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">No more errors!</h1>
      </div>
      <MadeWithDyad />
    </div>
  );
};

export default Index;

      </dyad-write>
      `;
    }
    console.error("LASTMESSAGE", lastMessage);
    // Check if the last message is "[dump]" to write messages to file and return path
    if (
      lastMessage &&
      (Array.isArray(lastMessage.content)
        ? lastMessage.content.some(
            (part: { type: string; text: string }) =>
              part.type === "text" && part.text.includes("[dump]"),
          )
        : lastMessage.content.includes("[dump]"))
    ) {
      messageContent = generateDump(req);
    }

    if (lastMessage && lastMessage.content === "[increment]") {
      globalCounter++;
      messageContent = `counter=${globalCounter}`;
    }

    // Check if the last message starts with "tc=" to load test case file
    if (
      lastMessage &&
      lastMessage.content &&
      typeof lastMessage.content === "string" &&
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
        prefix,
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

    if (
      lastMessage &&
      lastMessage.content &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.trim().endsWith("[[STRING_TO_BE_FINISHED]]")
    ) {
      messageContent = `[[STRING_IS_FINISHED]]";</dyad-write>\nFinished writing file.`;
      messageContent += "\n\n" + generateDump(req);
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
    }, 10);
  };

function generateDump(req: Request) {
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
      JSON.stringify(
        {
          body: req.body,
          headers: { authorization: req.headers["authorization"] },
        },
        null,
        2,
      ).replace(/\r\n/g, "\n"),
      "utf-8",
    );
    console.log(`* Dumped messages to: ${dumpFilePath}`);
    return `[[dyad-dump-path=${dumpFilePath}]]`;
  } catch (error) {
    console.error(`* Error writing dump file: ${error}`);
    return `Error: Could not write dump file: ${error}`;
  }
}
