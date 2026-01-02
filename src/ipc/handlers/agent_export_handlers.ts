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
MODEL_ID=${agent.modelId || "gpt-4o"}
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

const MODEL_ID = process.env.MODEL_ID || "${agent.modelId || "gpt-4o"}";
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

  console.log("\\n🤖 ${agent.name} is ready!");
  console.log("Type your message and press Enter. Type 'exit' to quit.\\n");

  const prompt = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "exit") {
        console.log("\\nGoodbye! 👋");
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
| MODEL_ID | Model to use | ${agent.modelId || "gpt-4o"} |
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
// Register Handlers
// ============================================================================

export function registerAgentExportHandlers(): void {
  ipcMain.handle("agent:export:json", handleExportAgentJson);
  ipcMain.handle("agent:export:standalone", handleExportAgentStandalone);
  ipcMain.handle("agent:export:docker", handleExportAgentDocker);

  logger.info("Agent export handlers registered");
}
