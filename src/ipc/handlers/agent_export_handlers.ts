/**
 * Agent Export and Deployment Handlers
 * Export agents to various formats and deploy to different targets
 */

import { IpcMainInvokeEvent, ipcMain } from "electron";
import fs from "fs-extra";
import path from "node:path";
import log from "electron-log";
import { db } from "@/db";
import {
  agents,
  agentTools,
  agentWorkflows,
  agentKnowledgeBases,
  agentUIComponents,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserDataPath } from "@/paths/paths";
import { app } from "electron";

function getAgentsExportPath(): string {
  return path.join(getUserDataPath(), "agent-exports");
}

import type {
  ExportAgentRequest,
  ExportAgentResponse,
  Agent,
  AgentTool,
  DeploymentTarget,
} from "@/types/agent_builder";

const logger = log.scope("agent_export");

// ============================================================================
// Export Agent as JSON
// ============================================================================

export async function handleExportAgentJson(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<ExportAgentResponse> {
  try {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
      with: {
        tools: true,
        workflows: true,
        knowledgeBases: true,
        uiComponents: true,
      },
    });

    if (!agent) {
      return { success: false, error: "Agent not found" };
    }

    const exportData = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      agent: {
        name: agent.name,
        description: agent.description,
        type: agent.type,
        systemPrompt: agent.systemPrompt,
        modelId: agent.modelId,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        config: agent.configJson,
      },
      tools: agent.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        implementationCode: t.implementationCode,
        requiresApproval: t.requiresApproval,
      })),
      workflows: agent.workflows?.map((w) => ({
        name: w.name,
        description: w.description,
        definition: w.workflowJson,
        isDefault: w.isDefault,
      })),
    };

    const exportDir = path.join(getAgentsExportPath(), "exports");
    await fs.ensureDir(exportDir);

    const filename = `agent-${agent.name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.json`;
    const exportPath = path.join(exportDir, filename);

    await fs.writeJson(exportPath, exportData, { spaces: 2 });

    return { success: true, exportPath };
  } catch (error) {
    logger.error("Failed to export agent:", error);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Export Agent as Standalone App
// ============================================================================

export async function handleExportAgentStandalone(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<ExportAgentResponse> {
  try {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
      with: {
        tools: true,
        workflows: true,
        uiComponents: true,
      },
    });

    if (!agent) {
      return { success: false, error: "Agent not found" };
    }

    const exportDir = path.join(
      getAgentsExportPath(),
      "standalone",
      `agent-${agent.name.replace(/\s+/g, "-").toLowerCase()}`
    );
    await fs.ensureDir(exportDir);

    // Create package.json
    const packageJson = {
      name: agent.name.replace(/\s+/g, "-").toLowerCase(),
      version: agent.version || "1.0.0",
      description: agent.description || `AI Agent: ${agent.name}`,
      main: "dist/index.js",
      type: "module",
      scripts: {
        build: "tsc",
        start: "node dist/index.js",
        dev: "tsx src/index.ts",
      },
      dependencies: {
        ai: "^4.0.0",
        openai: "^4.0.0",
        dotenv: "^16.0.0",
      },
      devDependencies: {
        typescript: "^5.0.0",
        tsx: "^4.0.0",
        "@types/node": "^20.0.0",
      },
    };

    await fs.writeJson(path.join(exportDir, "package.json"), packageJson, { spaces: 2 });

    // Create tsconfig.json
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        outDir: "./dist",
        rootDir: "./src",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ["src/**/*"],
    };

    await fs.writeJson(path.join(exportDir, "tsconfig.json"), tsconfig, { spaces: 2 });

    // Create src directory
    await fs.ensureDir(path.join(exportDir, "src"));

    // Create main agent file
    const agentCode = generateAgentCode(agent);
    await fs.writeFile(path.join(exportDir, "src", "index.ts"), agentCode);

    // Create tools file
    if (agent.tools && agent.tools.length > 0) {
      const toolsCode = generateToolsCode(agent.tools);
      await fs.writeFile(path.join(exportDir, "src", "tools.ts"), toolsCode);
    }

    // Create .env.example
    const envExample = `# OpenAI API Key
OPENAI_API_KEY=your-api-key-here

# Model configuration
MODEL_ID=${agent.modelId || "gpt-5-mini"}
TEMPERATURE=${agent.temperature || 0.7}
MAX_TOKENS=${agent.maxTokens || 4096}
`;
    await fs.writeFile(path.join(exportDir, ".env.example"), envExample);

    // Create README
    const readme = generateReadme(agent);
    await fs.writeFile(path.join(exportDir, "README.md"), readme);

    logger.info("Agent exported to:", exportDir);
    return { success: true, exportPath: exportDir };
  } catch (error) {
    logger.error("Failed to export agent:", error);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Export Agent as Docker Container
// ============================================================================

export async function handleExportAgentDocker(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<ExportAgentResponse> {
  try {
    // First export as standalone
    const standaloneResult = await handleExportAgentStandalone(_event, agentId);
    if (!standaloneResult.success || !standaloneResult.exportPath) {
      return standaloneResult;
    }

    const exportDir = standaloneResult.exportPath;

    // Add Dockerfile
    const dockerfile = `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
`;
    await fs.writeFile(path.join(exportDir, "Dockerfile"), dockerfile);

    // Add docker-compose.yml
    const dockerCompose = `version: '3.8'

services:
  agent:
    build: .
    ports:
      - "3000:3000"
    environment:
      - OPENAI_API_KEY=\${OPENAI_API_KEY}
    restart: unless-stopped
`;
    await fs.writeFile(path.join(exportDir, "docker-compose.yml"), dockerCompose);

    // Add .dockerignore
    const dockerIgnore = `node_modules
dist
.env
*.log
`;
    await fs.writeFile(path.join(exportDir, ".dockerignore"), dockerIgnore);

    return { success: true, exportPath: exportDir };
  } catch (error) {
    logger.error("Failed to export agent as Docker:", error);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Code Generation Helpers
// ============================================================================

function generateAgentCode(agent: any): string {
  const hasTools = agent.tools && agent.tools.length > 0;

  return `/**
 * ${agent.name}
 * ${agent.description || "AI Agent"}
 * 
 * Generated by JoyCreate Agent Builder
 */

import { openai } from "@ai-sdk/openai";
import { streamText, generateText } from "ai";
import "dotenv/config";
${hasTools ? 'import { tools } from "./tools.js";' : ""}

const MODEL_ID = process.env.MODEL_ID || "${agent.modelId || "gpt-5-mini"}";
const TEMPERATURE = parseFloat(process.env.TEMPERATURE || "${agent.temperature || 0.7}");
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "${agent.maxTokens || 4096}");

const SYSTEM_PROMPT = \`${agent.systemPrompt || "You are a helpful AI assistant."}\`;

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

class Agent {
  private messages: Message[] = [];

  constructor() {
    this.messages.push({
      role: "system",
      content: SYSTEM_PROMPT,
    });
  }

  async chat(userMessage: string): Promise<string> {
    this.messages.push({
      role: "user",
      content: userMessage,
    });

    const result = await generateText({
      model: openai(MODEL_ID),
      messages: this.messages,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      ${hasTools ? "tools," : ""}
    });

    const assistantMessage = result.text;
    this.messages.push({
      role: "assistant",
      content: assistantMessage,
    });

    return assistantMessage;
  }

  async *chatStream(userMessage: string): AsyncGenerator<string> {
    this.messages.push({
      role: "user",
      content: userMessage,
    });

    const result = streamText({
      model: openai(MODEL_ID),
      messages: this.messages,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      ${hasTools ? "tools," : ""}
    });

    let fullResponse = "";
    for await (const chunk of result.textStream) {
      fullResponse += chunk;
      yield chunk;
    }

    this.messages.push({
      role: "assistant",
      content: fullResponse,
    });
  }

  clearHistory(): void {
    this.messages = [this.messages[0]]; // Keep system prompt
  }
}

// CLI Interface
async function main() {
  const agent = new Agent();
  const readline = await import("readline");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\\nðŸ¤– ${agent.name} is ready!");
  console.log("Type your message and press Enter. Type 'exit' to quit.\\n");

  const prompt = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "exit") {
        console.log("\\nGoodbye! ðŸ‘‹");
        rl.close();
        return;
      }

      process.stdout.write("Assistant: ");
      for await (const chunk of agent.chatStream(input)) {
        process.stdout.write(chunk);
      }
      console.log("\\n");

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);

export { Agent };
`;
}

function generateToolsCode(tools: any[]): string {
  const toolDefinitions = tools.map((tool) => {
    return `  ${tool.name}: {
    description: "${tool.description}",
    parameters: ${JSON.stringify(tool.inputSchema || { type: "object", properties: {} }, null, 4).replace(/\n/g, "\n    ")},
    execute: async (args: Record<string, unknown>) => {
      // Tool implementation
      ${tool.implementationCode || `console.log("${tool.name} called with:", args);
      return { success: true, result: "Tool executed" };`}
    },
  }`;
  });

  return `/**
 * Agent Tools
 * Custom tools for the AI agent
 */

import { tool } from "ai";
import { z } from "zod";

export const tools = {
${toolDefinitions.join(",\n\n")}
};
`;
}

function generateReadme(agent: any): string {
  return `# ${agent.name}

${agent.description || "AI Agent generated by JoyCreate Agent Builder"}

## Setup

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Create a \`.env\` file based on \`.env.example\`:
\`\`\`bash
cp .env.example .env
\`\`\`

3. Add your OpenAI API key to the \`.env\` file.

## Usage

### Development
\`\`\`bash
npm run dev
\`\`\`

### Production
\`\`\`bash
npm run build
npm start
\`\`\`

### Docker
\`\`\`bash
docker-compose up -d
\`\`\`

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| OPENAI_API_KEY | OpenAI API key | required |
| MODEL_ID | Model to use | ${agent.modelId || "gpt-5-mini"} |
| TEMPERATURE | Sampling temperature | ${agent.temperature || 0.7} |
| MAX_TOKENS | Maximum tokens | ${agent.maxTokens || 4096} |

## Agent Details

- **Type**: ${agent.type}
- **Version**: ${agent.version || "1.0.0"}
${agent.tools?.length ? `- **Tools**: ${agent.tools.length} custom tool(s)` : ""}

---

Generated by JoyCreate Agent Builder
`;
}

// ============================================================================
// Export Agent as Embeddable Web Chat Widget
// ============================================================================

export async function handleExportAgentWebChat(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<ExportAgentResponse> {
  try {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
      with: { tools: true, workflows: true, uiComponents: true },
    });

    if (!agent) {
      return { success: false, error: "Agent not found" };
    }

    const slugName = agent.name.replace(/\s+/g, "-").toLowerCase();
    const exportDir = path.join(getAgentsExportPath(), "web-chat", `agent-${slugName}`);
    await fs.ensureDir(exportDir);

    // package.json
    const packageJson = {
      name: `${slugName}-chat`,
      version: agent.version || "1.0.0",
      description: `${agent.name} â€” Embeddable AI Chat Widget`,
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      },
      dependencies: {
        ai: "^4.0.0",
        openai: "^4.0.0",
      },
      devDependencies: {
        vite: "^6.0.0",
      },
    };
    await fs.writeJson(path.join(exportDir, "package.json"), packageJson, { spaces: 2 });

    // vite.config.js
    const viteConfig = `import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  build: { outDir: "dist" },
});
`;
    await fs.writeFile(path.join(exportDir, "vite.config.js"), viteConfig);

    // index.html
    const indexHtml = generateChatWidgetHtml(agent);
    await fs.writeFile(path.join(exportDir, "index.html"), indexHtml);

    // API server (server.js)
    const serverJs = generateChatApiServer(agent);
    await fs.writeFile(path.join(exportDir, "server.js"), serverJs);

    // .env.example
    const envExample = `# AI Provider API Key (OpenAI, DeepSeek, etc.)
API_KEY=your-api-key-here
# Provider base URL (change for DeepSeek, local Ollama, etc.)
# OpenAI:    https://api.openai.com/v1
# DeepSeek:  https://api.deepseek.com/v1
# Ollama:    http://localhost:11434/v1
# LM Studio: http://localhost:1234/v1
BASE_URL=https://api.openai.com/v1
MODEL_ID=${agent.modelId || "gpt-5-mini"}
PORT=3001
`;
    await fs.writeFile(path.join(exportDir, ".env.example"), envExample);

    // Dockerfile for self-hosting
    const dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx vite build
EXPOSE 3001
CMD ["node", "server.js"]
`;
    await fs.writeFile(path.join(exportDir, "Dockerfile"), dockerfile);

    // docker-compose.yml
    const dockerCompose = `services:
  chat:
    build: .
    ports:
      - "3001:3001"
    environment:
      - API_KEY=\${API_KEY}
      - BASE_URL=\${BASE_URL:-https://api.openai.com/v1}
      - MODEL_ID=\${MODEL_ID:-${agent.modelId || "gpt-5-mini"}}
    restart: unless-stopped
`;
    await fs.writeFile(path.join(exportDir, "docker-compose.yml"), dockerCompose);

    // README.md
    const readme = generateWebChatReadme(agent);
    await fs.writeFile(path.join(exportDir, "README.md"), readme);

    logger.info("Web chat widget exported to:", exportDir);
    return { success: true, exportPath: exportDir };
  } catch (error) {
    logger.error("Failed to export web chat widget:", error);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Generate Embed Snippet
// ============================================================================

export async function handleExportEmbedSnippet(
  _event: IpcMainInvokeEvent,
  agentId: number,
  hostUrl?: string
): Promise<ExportAgentResponse> {
  try {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });

    if (!agent) {
      return { success: false, error: "Agent not found" };
    }

    const baseUrl = hostUrl || "http://localhost:3001";

    const embedCode = `<!-- ${agent.name} Chat Widget -->
<div id="joycreate-chat-widget"></div>
<script>
(function() {
  var d = document, s = d.createElement("script");
  s.src = "${baseUrl}/widget.js";
  s.async = true;
  s.dataset.agentName = ${JSON.stringify(agent.name)};
  s.dataset.apiUrl = "${baseUrl}";
  d.body.appendChild(s);
})();
</script>`;

    return { success: true, embedCode };
  } catch (error) {
    logger.error("Failed to generate embed snippet:", error);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Web Chat Widget HTML Generation
// ============================================================================

function generateChatWidgetHtml(agent: any): string {
  const agentName = agent.name || "AI Assistant";
  const welcomeMsg = agent.description || `Hi! I'm ${agentName}. How can I help you?`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${agentName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f; --surface: #141420; --border: #23233a;
      --text: #e2e8f0; --muted: #94a3b8; --primary: #6366f1;
      --primary-hover: #818cf8; --user-bg: #1e1e38; --bot-bg: #1a1a2e;
    }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
    .chat-header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 20px; display: flex; align-items: center; gap: 12px; }
    .chat-header .avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), #a855f7); display: flex; align-items: center; justify-content: center; font-size: 18px; }
    .chat-header h1 { font-size: 16px; font-weight: 600; }
    .chat-header .status { font-size: 12px; color: var(--muted); }
    .messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .message { max-width: 80%; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; }
    .message.user { align-self: flex-end; background: var(--user-bg); border: 1px solid var(--border); border-bottom-right-radius: 4px; }
    .message.assistant { align-self: flex-start; background: var(--bot-bg); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
    .message.assistant .name { font-size: 11px; color: var(--muted); margin-bottom: 4px; font-weight: 600; }
    .typing { display: flex; gap: 4px; padding: 4px 0; }
    .typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: bounce 1.4s ease-in-out infinite; }
    .typing span:nth-child(2) { animation-delay: 0.2s; }
    .typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-8px); } }
    .input-area { background: var(--surface); border-top: 1px solid var(--border); padding: 16px 20px; display: flex; gap: 12px; }
    .input-area textarea { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; color: var(--text); font-size: 14px; font-family: inherit; resize: none; outline: none; min-height: 44px; max-height: 120px; }
    .input-area textarea:focus { border-color: var(--primary); }
    .input-area button { background: var(--primary); color: white; border: none; border-radius: 12px; padding: 0 20px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.2s; }
    .input-area button:hover { background: var(--primary-hover); }
    .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (max-width: 640px) { .message { max-width: 90%; } }
  </style>
</head>
<body>
  <header class="chat-header">
    <div class="avatar">ðŸ¤–</div>
    <div>
      <h1>${agentName}</h1>
      <div class="status">Online</div>
    </div>
  </header>

  <div class="messages" id="messages">
    <div class="message assistant">
      <div class="name">${agentName}</div>
      ${welcomeMsg}
    </div>
  </div>

  <div class="input-area">
    <textarea id="userInput" placeholder="Type a message..." rows="1"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage();}"></textarea>
    <button id="sendBtn" onclick="sendMessage()">Send</button>
  </div>

  <script>
    const API_URL = window.CHAT_API_URL || "/api/chat";
    const AGENT_NAME = ${JSON.stringify(agentName)};
    const SYSTEM_PROMPT = ${JSON.stringify(agent.systemPrompt || "You are a helpful AI assistant.")};
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];

    function addMessage(role, content) {
      const div = document.createElement("div");
      div.className = "message " + role;
      if (role === "assistant") {
        div.innerHTML = '<div class="name">' + AGENT_NAME + '</div>' + escapeHtml(content);
      } else {
        div.textContent = content;
      }
      document.getElementById("messages").appendChild(div);
      div.scrollIntoView({ behavior: "smooth" });
      return div;
    }

    function escapeHtml(text) {
      const d = document.createElement("div");
      d.textContent = text;
      return d.innerHTML;
    }

    function showTyping() {
      const div = document.createElement("div");
      div.className = "message assistant";
      div.id = "typing";
      div.innerHTML = '<div class="name">' + AGENT_NAME + '</div><div class="typing"><span></span><span></span><span></span></div>';
      document.getElementById("messages").appendChild(div);
      div.scrollIntoView({ behavior: "smooth" });
    }

    function removeTyping() {
      const el = document.getElementById("typing");
      if (el) el.remove();
    }

    async function sendMessage() {
      const input = document.getElementById("userInput");
      const text = input.value.trim();
      if (!text) return;

      input.value = "";
      input.style.height = "auto";
      document.getElementById("sendBtn").disabled = true;

      addMessage("user", text);
      messages.push({ role: "user", content: text });
      showTyping();

      try {
        const resp = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: messages.filter(m => m.role !== "system"), systemPrompt: SYSTEM_PROMPT }),
        });

        removeTyping();

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || resp.statusText);
        }

        const data = await resp.json();
        const reply = data.choices?.[0]?.message?.content || data.message?.content || data.content || "No response";

        addMessage("assistant", reply);
        messages.push({ role: "assistant", content: reply });
      } catch (err) {
        removeTyping();
        addMessage("assistant", "Error: " + err.message);
      } finally {
        document.getElementById("sendBtn").disabled = false;
        input.focus();
      }
    }

    // Auto-resize textarea
    document.getElementById("userInput").addEventListener("input", function() {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 120) + "px";
    });
  </script>
</body>
</html>`;
}

// ============================================================================
// Chat API Server (Node.js)
// ============================================================================

function generateChatApiServer(agent: any): string {
  return `/**
 * ${agent.name} â€” Chat API Server
 * Serves the chat widget and proxies AI requests.
 *
 * Supports any OpenAI-compatible provider:
 *   OpenAI, DeepSeek, Ollama, LM Studio, Together, Groq, etc.
 *
 * Generated by JoyCreate Agent Builder
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const API_KEY    = process.env.API_KEY    || "";
const BASE_URL   = process.env.BASE_URL   || "https://api.openai.com/v1";
const MODEL_ID   = process.env.MODEL_ID   || ${JSON.stringify(agent.modelId || "gpt-5-mini")};
const PORT       = parseInt(process.env.PORT || "3001", 10);
const SYSTEM_PROMPT = ${JSON.stringify(agent.systemPrompt || "You are a helpful AI assistant.")};

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Chat endpoint
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { messages, systemPrompt } = JSON.parse(body);
      const allMessages = [
        { role: "system", content: systemPrompt || SYSTEM_PROMPT },
        ...messages,
      ];

      const headers = { "Content-Type": "application/json" };
      if (API_KEY) headers["Authorization"] = "Bearer " + API_KEY;

      const aiResp = await fetch(BASE_URL + "/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({ model: MODEL_ID, messages: allMessages, temperature: ${agent.temperature || 0.7}, stream: false }),
      });

      if (!aiResp.ok) {
        const err = await aiResp.json().catch(() => ({}));
        res.writeHead(aiResp.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.error?.message || aiResp.statusText }));
        return;
      }

      const data = await aiResp.json();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Health check
  if (req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", agent: ${JSON.stringify(agent.name)}, model: MODEL_ID }));
    return;
  }

  // Widget JS (embeddable)
  if (req.url === "/widget.js") {
    const widgetJs = generateWidgetLoader();
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end(widgetJs);
    return;
  }

  // Static file serving
  const filePath = join(process.cwd(), req.url === "/" ? "index.html" : req.url);
  if (existsSync(filePath)) {
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(readFileSync(filePath));
  } else {
    // SPA fallback
    const indexPath = join(process.cwd(), "index.html");
    if (existsSync(indexPath)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(readFileSync(indexPath));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  }
});

function generateWidgetLoader() {
  return \`
(function() {
  var container = document.getElementById("joycreate-chat-widget");
  if (!container) { container = document.createElement("div"); container.id = "joycreate-chat-widget"; document.body.appendChild(container); }

  var iframe = document.createElement("iframe");
  var script = document.currentScript || document.querySelector('script[data-agent-name]');
  var apiUrl = (script && script.dataset.apiUrl) || window.location.origin;
  iframe.src = apiUrl;
  iframe.style.cssText = "position:fixed;bottom:20px;right:20px;width:400px;height:600px;border:none;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:9999;";
  container.appendChild(iframe);

  var toggle = document.createElement("button");
  toggle.innerHTML = "ðŸ’¬";
  toggle.style.cssText = "position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#6366f1;color:white;border:none;font-size:24px;cursor:pointer;z-index:10000;box-shadow:0 4px 16px rgba(99,102,241,0.4);display:none;";
  toggle.onclick = function() { iframe.style.display = iframe.style.display === "none" ? "block" : "none"; };
  container.appendChild(toggle);
})();
\`;
}

server.listen(PORT, () => {
  console.log("");
  console.log("  ðŸ¤– ${agent.name} Chat Widget");
  console.log("  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€");
  console.log("  Chat UI:   http://localhost:" + PORT);
  console.log("  API:       http://localhost:" + PORT + "/api/chat");
  console.log("  Health:    http://localhost:" + PORT + "/api/health");
  console.log("  Widget JS: http://localhost:" + PORT + "/widget.js");
  console.log("  Model:     " + MODEL_ID);
  console.log("  Provider:  " + BASE_URL);
  console.log("");
  console.log("  Embed in any page:");
  console.log('  <script src="http://localhost:' + PORT + '/widget.js" data-api-url="http://localhost:' + PORT + '"><\\/script>');
  console.log("");
});
`;
}

// ============================================================================
// Web Chat Widget README
// ============================================================================

function generateWebChatReadme(agent: any): string {
  return `# ${agent.name} â€” Chat Widget

${agent.description || "AI Chat Widget generated by JoyCreate Agent Builder"}

## Quick Start

\`\`\`bash
npm install
cp .env.example .env
# Edit .env with your API key and provider
node server.js
\`\`\`

Open **http://localhost:3001** in your browser.

## Provider Configuration

This widget works with **any OpenAI-compatible API**. Set \`BASE_URL\` in \`.env\`:

| Provider | BASE_URL |
|----------|----------|
| OpenAI | \`https://api.openai.com/v1\` |
| DeepSeek | \`https://api.deepseek.com/v1\` |
| Google Gemini (OpenAI compat) | \`https://generativelanguage.googleapis.com/v1beta/openai\` |
| Ollama (local) | \`http://localhost:11434/v1\` |
| LM Studio (local) | \`http://localhost:1234/v1\` |
| Together AI | \`https://api.together.xyz/v1\` |
| Groq | \`https://api.groq.com/openai/v1\` |
| Fireworks AI | \`https://api.fireworks.ai/inference/v1\` |

## Embed in Any Website

Add this script tag to your page:

\`\`\`html
<script src="http://YOUR_HOST:3001/widget.js" data-api-url="http://YOUR_HOST:3001"></script>
\`\`\`

## Deploy

### Docker
\`\`\`bash
docker-compose up -d
\`\`\`

### IPFS (Decentralized)
Build the static files and pin to IPFS:
\`\`\`bash
npx vite build
npx ipfs-car pack dist -o widget.car
# Upload widget.car to web3.storage, Pinata, or 4everland
\`\`\`

### Vercel / Netlify
Deploy the \`dist/\` folder after \`npx vite build\`.

---

Generated by JoyCreate Agent Builder
`;
}

// ============================================================================
// Register Handlers
// ============================================================================

export function registerAgentExportHandlers(): void {
  ipcMain.handle("agent:export:json", handleExportAgentJson);
  ipcMain.handle("agent:export:standalone", handleExportAgentStandalone);
  ipcMain.handle("agent:export:docker", handleExportAgentDocker);
  ipcMain.handle("agent:export:web-chat", handleExportAgentWebChat);
  ipcMain.handle("agent:export:embed-snippet", handleExportEmbedSnippet);

  logger.info("Agent export handlers registered");
}
