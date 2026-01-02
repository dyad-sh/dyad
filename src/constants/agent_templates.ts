/**
 * Agent Templates
 * Pre-built templates for creating different types of AI agents
 */

import type { AgentTemplate, AgentType, AgentTemplateCategory } from "@/types/agent_builder";

export const AGENT_TEMPLATES: AgentTemplate[] = [
  // ============================================================================
  // Customer Service Templates
  // ============================================================================
  {
    id: "customer-support-chatbot",
    name: "Customer Support Chatbot",
    description: "A helpful chatbot that answers customer questions and provides support",
    type: "chatbot",
    category: "customer-service",
    thumbnail: "/templates/customer-support.png",
    systemPrompt: `You are a friendly and professional customer support agent. Your role is to:

1. Greet customers warmly and professionally
2. Listen carefully to their questions or concerns
3. Provide accurate and helpful information
4. Offer solutions to problems when possible
5. Escalate complex issues when necessary
6. Always maintain a positive and empathetic tone

Guidelines:
- Be patient and understanding
- Use clear, simple language
- Provide step-by-step instructions when needed
- Always confirm you've addressed the customer's needs
- Thank customers for their patience and business`,
    config: {
      memory: {
        type: "buffer",
        maxMessages: 20,
      },
      retry: {
        maxRetries: 3,
        backoffMs: 1000,
      },
    },
    tools: [
      {
        name: "lookup_order",
        description: "Look up an order by order ID or customer email",
        inputSchema: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "The order ID to look up" },
            email: { type: "string", description: "Customer email address" },
          },
        },
      },
      {
        name: "create_ticket",
        description: "Create a support ticket for complex issues",
        inputSchema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Ticket subject" },
            description: { type: "string", description: "Detailed description of the issue" },
            priority: { type: "string", enum: ["low", "medium", "high"], description: "Ticket priority" },
          },
          required: ["subject", "description"],
        },
      },
    ],
    uiComponents: [
      {
        name: "ChatInterface",
        componentType: "chat",
      },
    ],
  },

  // ============================================================================
  // Data Analysis Templates
  // ============================================================================
  {
    id: "data-analyst",
    name: "Data Analysis Agent",
    description: "An agent that analyzes data, generates insights, and creates visualizations",
    type: "task",
    category: "data-analysis",
    thumbnail: "/templates/data-analyst.png",
    systemPrompt: `You are an expert data analyst assistant. Your capabilities include:

1. Analyzing datasets to find patterns and insights
2. Performing statistical analysis
3. Creating data visualizations
4. Writing SQL queries to extract data
5. Explaining findings in clear, non-technical language
6. Providing actionable recommendations based on data

Guidelines:
- Always validate data quality before analysis
- Explain your methodology clearly
- Use appropriate statistical methods
- Present findings with visualizations when helpful
- Highlight key insights and anomalies
- Provide context for numbers and percentages`,
    config: {
      memory: {
        type: "buffer",
        maxMessages: 30,
      },
    },
    tools: [
      {
        name: "execute_sql",
        description: "Execute a SQL query against the connected database",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The SQL query to execute" },
            database: { type: "string", description: "Target database name" },
          },
          required: ["query"],
        },
        requiresApproval: true,
      },
      {
        name: "create_chart",
        description: "Create a chart or visualization from data",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["bar", "line", "pie", "scatter", "histogram"], description: "Chart type" },
            data: { type: "object", description: "Data for the chart" },
            title: { type: "string", description: "Chart title" },
          },
          required: ["type", "data"],
        },
      },
      {
        name: "calculate_statistics",
        description: "Calculate statistical measures for a dataset",
        inputSchema: {
          type: "object",
          properties: {
            data: { type: "array", items: { type: "number" }, description: "Array of numbers" },
            measures: { type: "array", items: { type: "string" }, description: "Statistics to calculate" },
          },
          required: ["data"],
        },
      },
    ],
    uiComponents: [
      {
        name: "DashboardView",
        componentType: "dashboard",
      },
    ],
  },

  // ============================================================================
  // Coding Assistant Templates
  // ============================================================================
  {
    id: "code-assistant",
    name: "Coding Assistant",
    description: "An AI assistant that helps write, review, and debug code",
    type: "chatbot",
    category: "coding-assistant",
    thumbnail: "/templates/code-assistant.png",
    systemPrompt: `You are an expert software development assistant. Your capabilities include:

1. Writing clean, efficient, and well-documented code
2. Debugging and fixing code issues
3. Code review and providing improvement suggestions
4. Explaining complex code concepts
5. Helping with architecture and design decisions
6. Writing tests and documentation

Guidelines:
- Always follow best practices and coding standards
- Write readable, maintainable code
- Include comments for complex logic
- Consider security implications
- Suggest optimizations when appropriate
- Explain your reasoning for design decisions

Supported languages: JavaScript, TypeScript, Python, Go, Rust, and more.`,
    config: {
      memory: {
        type: "buffer",
        maxMessages: 50,
      },
    },
    tools: [
      {
        name: "read_file",
        description: "Read the contents of a file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the file" },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["path", "content"],
        },
        requiresApproval: true,
      },
      {
        name: "run_command",
        description: "Run a shell command",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command to execute" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["command"],
        },
        requiresApproval: true,
      },
      {
        name: "search_code",
        description: "Search for code patterns in the codebase",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query or regex pattern" },
            fileTypes: { type: "array", items: { type: "string" }, description: "File extensions to search" },
          },
          required: ["query"],
        },
      },
    ],
  },

  // ============================================================================
  // Research Templates
  // ============================================================================
  {
    id: "research-assistant",
    name: "Research Assistant",
    description: "An agent that helps with research, summarizing documents, and finding information",
    type: "rag",
    category: "research",
    thumbnail: "/templates/research-assistant.png",
    systemPrompt: `You are a thorough and accurate research assistant. Your capabilities include:

1. Searching and retrieving relevant information
2. Summarizing documents and articles
3. Comparing multiple sources
4. Fact-checking and verifying information
5. Creating structured research reports
6. Citing sources properly

Guidelines:
- Always cite your sources
- Distinguish between facts and opinions
- Present multiple perspectives when relevant
- Highlight areas of uncertainty or conflicting information
- Organize findings in a clear, logical structure
- Use direct quotes when accuracy is critical`,
    config: {
      memory: {
        type: "vector",
        maxMessages: 100,
      },
    },
    tools: [
      {
        name: "search_knowledge_base",
        description: "Search the knowledge base for relevant documents",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            topK: { type: "number", description: "Number of results to return" },
          },
          required: ["query"],
        },
      },
      {
        name: "web_search",
        description: "Search the web for information",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            numResults: { type: "number", description: "Number of results" },
          },
          required: ["query"],
        },
      },
      {
        name: "summarize_document",
        description: "Generate a summary of a document",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "Document content" },
            style: { type: "string", enum: ["brief", "detailed", "bullet-points"], description: "Summary style" },
          },
          required: ["content"],
        },
      },
    ],
  },

  // ============================================================================
  // Content Creation Templates
  // ============================================================================
  {
    id: "content-writer",
    name: "Content Writer",
    description: "An agent that creates various types of written content",
    type: "chatbot",
    category: "content-creation",
    thumbnail: "/templates/content-writer.png",
    systemPrompt: `You are a skilled content writer and editor. Your capabilities include:

1. Writing blog posts, articles, and social media content
2. Creating marketing copy and product descriptions
3. Editing and proofreading text
4. Adapting tone and style for different audiences
5. Optimizing content for SEO
6. Creating outlines and content strategies

Guidelines:
- Match the tone to the target audience
- Use clear, engaging language
- Follow SEO best practices when relevant
- Maintain consistency in voice and style
- Proofread for grammar and spelling
- Structure content for readability`,
    config: {
      memory: {
        type: "buffer",
        maxMessages: 20,
      },
    },
    tools: [
      {
        name: "check_grammar",
        description: "Check text for grammar and spelling errors",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to check" },
          },
          required: ["text"],
        },
      },
      {
        name: "analyze_seo",
        description: "Analyze content for SEO optimization",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "Content to analyze" },
            targetKeywords: { type: "array", items: { type: "string" }, description: "Target keywords" },
          },
          required: ["content"],
        },
      },
    ],
  },

  // ============================================================================
  // Automation Templates
  // ============================================================================
  {
    id: "workflow-automator",
    name: "Workflow Automator",
    description: "An agent that automates repetitive tasks and workflows",
    type: "workflow",
    category: "automation",
    thumbnail: "/templates/workflow-automator.png",
    systemPrompt: `You are a workflow automation specialist. Your role is to:

1. Identify repetitive tasks that can be automated
2. Design efficient workflows
3. Execute multi-step processes reliably
4. Handle errors and edge cases gracefully
5. Report progress and results clearly
6. Optimize workflows for efficiency

Guidelines:
- Break complex tasks into manageable steps
- Validate inputs before processing
- Handle errors gracefully with retries
- Log important actions and decisions
- Provide progress updates for long-running tasks
- Confirm destructive actions before executing`,
    config: {
      retry: {
        maxRetries: 5,
        backoffMs: 2000,
      },
      rateLimit: {
        requestsPerMinute: 30,
      },
    },
    workflow: {
      nodes: [
        {
          id: "start",
          type: "llm",
          name: "Analyze Task",
          config: {
            prompt: "Analyze the user's request and create a step-by-step plan.",
          },
        },
        {
          id: "execute",
          type: "loop",
          name: "Execute Steps",
          config: {
            maxIterations: 10,
          },
        },
        {
          id: "report",
          type: "llm",
          name: "Generate Report",
          config: {
            prompt: "Summarize what was accomplished and any issues encountered.",
          },
        },
      ],
      edges: [
        { id: "e1", sourceId: "start", targetId: "execute" },
        { id: "e2", sourceId: "execute", targetId: "report" },
      ],
      entryNodeId: "start",
    },
    tools: [
      {
        name: "send_email",
        description: "Send an email",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body" },
          },
          required: ["to", "subject", "body"],
        },
        requiresApproval: true,
      },
      {
        name: "http_request",
        description: "Make an HTTP request to an API",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Request URL" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "HTTP method" },
            headers: { type: "object", description: "Request headers" },
            body: { type: "string", description: "Request body" },
          },
          required: ["url", "method"],
        },
      },
      {
        name: "schedule_task",
        description: "Schedule a task to run later",
        inputSchema: {
          type: "object",
          properties: {
            taskName: { type: "string", description: "Name of the task" },
            cronExpression: { type: "string", description: "Cron expression for scheduling" },
            payload: { type: "object", description: "Task payload" },
          },
          required: ["taskName", "cronExpression"],
        },
      },
    ],
  },

  // ============================================================================
  // Multi-Agent Templates
  // ============================================================================
  {
    id: "multi-agent-team",
    name: "Multi-Agent Team",
    description: "A team of specialized agents that collaborate to solve complex problems",
    type: "multi-agent",
    category: "general",
    thumbnail: "/templates/multi-agent.png",
    systemPrompt: `You are the coordinator of a multi-agent team. Your team includes:

1. **Researcher** - Gathers and analyzes information
2. **Planner** - Creates action plans and strategies
3. **Executor** - Implements solutions and takes actions
4. **Reviewer** - Validates results and provides feedback

Your role as coordinator is to:
- Understand the user's goals
- Delegate tasks to appropriate team members
- Synthesize outputs from different agents
- Ensure quality and consistency
- Report progress and final results

Always coordinate work efficiently and leverage each agent's strengths.`,
    config: {
      memory: {
        type: "summary",
        maxMessages: 50,
      },
    },
    workflow: {
      nodes: [
        {
          id: "coordinator",
          type: "llm",
          name: "Coordinator",
          config: {
            prompt: "Analyze the task and decide which agents to involve.",
          },
        },
        {
          id: "researcher",
          type: "subagent",
          name: "Researcher",
          config: {},
        },
        {
          id: "planner",
          type: "subagent",
          name: "Planner",
          config: {},
        },
        {
          id: "executor",
          type: "subagent",
          name: "Executor",
          config: {},
        },
        {
          id: "reviewer",
          type: "subagent",
          name: "Reviewer",
          config: {},
        },
        {
          id: "synthesize",
          type: "llm",
          name: "Synthesize Results",
          config: {
            prompt: "Combine outputs from all agents into a coherent response.",
          },
        },
      ],
      edges: [
        { id: "e1", sourceId: "coordinator", targetId: "researcher" },
        { id: "e2", sourceId: "coordinator", targetId: "planner" },
        { id: "e3", sourceId: "researcher", targetId: "executor" },
        { id: "e4", sourceId: "planner", targetId: "executor" },
        { id: "e5", sourceId: "executor", targetId: "reviewer" },
        { id: "e6", sourceId: "reviewer", targetId: "synthesize" },
      ],
      entryNodeId: "coordinator",
    },
  },

  // ============================================================================
  // Blank Template
  // ============================================================================
  {
    id: "blank",
    name: "Blank Agent",
    description: "Start from scratch with a blank agent template",
    type: "chatbot",
    category: "general",
    thumbnail: "/templates/blank.png",
    systemPrompt: "You are a helpful AI assistant.",
    config: {
      memory: {
        type: "buffer",
        maxMessages: 20,
      },
    },
  },
];

export function getTemplatesByCategory(category: AgentTemplateCategory): AgentTemplate[] {
  return AGENT_TEMPLATES.filter((t) => t.category === category);
}

export function getTemplatesByType(type: AgentType): AgentTemplate[] {
  return AGENT_TEMPLATES.filter((t) => t.type === type);
}

export function getTemplateById(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.id === id);
}

export const TEMPLATE_CATEGORIES: { value: AgentTemplateCategory; label: string; icon: string }[] = [
  { value: "customer-service", label: "Customer Service", icon: "headset" },
  { value: "data-analysis", label: "Data Analysis", icon: "chart-bar" },
  { value: "content-creation", label: "Content Creation", icon: "pen-tool" },
  { value: "coding-assistant", label: "Coding Assistant", icon: "code" },
  { value: "research", label: "Research", icon: "search" },
  { value: "automation", label: "Automation", icon: "cog" },
  { value: "general", label: "General", icon: "sparkles" },
];
