import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { CANNED_MESSAGE, createStreamChunk } from ".";

let globalCounter = 0;

export const createChatCompletionHandler =
  (prefix: string) => async (req: Request, res: Response) => {
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

    if (
      lastMessage &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.includes("[sleep=medium]")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
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
      const testCaseName = lastMessage.content.slice(3).split("[")[0].trim(); // Remove "tc=" prefix
      console.error(`* Loading test case: ${testCaseName}`);
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
          console.error(`* Test case file not found: ${testFilePath}`);
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
    const isToolCall = !!(
      lastMessage &&
      lastMessage.content &&
      lastMessage.content.includes("[call_tool=calculator_add]")
    );
    let message = {
      role: "assistant",
      content: messageContent,
    } as any;

    // Non-streaming response
    if (!stream) {
      if (isToolCall) {
        const toolCallId = `call_${Date.now()}`;
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
                tool_calls: [
                  {
                    id: toolCallId,
                    type: "function",
                    function: {
                      name: "calculator_add",
                      arguments: JSON.stringify({ a: 1, b: 2 }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      }
      return res.json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "fake-model",
        choices: [
          {
            index: 0,
            message,
            finish_reason: "stop",
          },
        ],
      });
    }

    // Streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Tool call streaming (OpenAI-style)
    if (isToolCall) {
      const now = Date.now();
      const mkChunk = (delta: any, finish: null | string = null) => {
        const chunk = {
          id: `chatcmpl-${now}`,
          object: "chat.completion.chunk",
          created: Math.floor(now / 1000),
          model: "fake-model",
          choices: [
            {
              index: 0,
              delta,
              finish_reason: finish,
            },
          ],
        };
        return `data: ${JSON.stringify(chunk)}\n\n`;
      };

      // 1) Send role
      res.write(mkChunk({ role: "assistant" }));

      // 2) Send tool_calls init with id + name + empty args
      const toolCallId = `call_${now}`;
      res.write(
        mkChunk({
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: "function",
              function: {
                name: "testing-mcp-server__calculator_add",
                arguments: "",
              },
            },
          ],
        }),
      );

      // 3) Stream arguments gradually
      const args = JSON.stringify({ a: 1, b: 2 });
      let i = 0;
      const argBatchSize = 6;
      const argInterval = setInterval(() => {
        if (i < args.length) {
          const part = args.slice(i, i + argBatchSize);
          i += argBatchSize;
          res.write(
            mkChunk({
              tool_calls: [{ index: 0, function: { arguments: part } }],
            }),
          );
        } else {
          // 4) Finalize with finish_reason tool_calls and [DONE]
          res.write(mkChunk({}, "tool_calls"));
          res.write("data: [DONE]\n\n");
          clearInterval(argInterval);
          res.end();
        }
      }, 10);
      return;
    }

    // Split the message into characters to simulate streaming
    const messageChars = messageContent.split("");

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
