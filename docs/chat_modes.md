# Chat Modes

Dyad offers different chat modes to optimize the AI's behavior for different types of tasks. Each mode uses a different system prompt and set of capabilities, allowing you to choose the right tool for your specific needs.

## Overview

Chat modes determine how the AI responds to your prompts. You can switch between modes at any time using the mode selector in the UI or by pressing `Ctrl+.` (Windows/Linux) or `Cmd+.` (Mac).

There are four available chat modes:

1. **Build** - The default mode for generating and editing code
2. **Ask** - For asking questions and getting explanations without code generation
3. **Build with MCP** - Like Build, but with access to external tools via Model Context Protocol
4. **Agent** (Experimental) - An advanced tool-based agent better at complex tasks and debugging

## Build Mode

**Display name:** Build
**Description:** Generate and edit code

Build mode is Dyad's default mode and what most users will use for day-to-day development. In this mode, the AI has full code generation and modification capabilities.

### What it can do

- Create new files using `<dyad-write>` tags
- Update existing code using `<dyad-search-replace>` tags
- Install NPM packages using `<dyad-add-dependency>`
- Rename and delete files
- Support for [Turbo Edits v2](https://github.com/dyad-sh/dyad/blob/main/src/prompts/system_prompt.ts) when enabled
- Auto-fix TypeScript problems when enabled in settings

### When to use it

Build mode is ideal for:
- Writing new features
- Fixing bugs
- Refactoring existing code
- Making targeted changes to your codebase

## Ask Mode

**Display name:** Ask
**Description:** Ask questions about the app

Ask mode is designed for learning and getting explanations. The AI is explicitly prohibited from generating or modifying code in this mode.

### What it can do

- Answer technical questions about your code
- Provide conceptual explanations
- Offer architectural guidance
- Help you understand how things work

### What it can't do

- Generate code
- Edit files
- Use any `<dyad-*>` tags
- Install packages or make changes

### When to use it

Ask mode is perfect for:
- Understanding how a feature works
- Getting architectural advice
- Learning about best practices
- Exploring your codebase without making changes

Note: Ask mode removes `<dyad-*>` tags from the message history to reduce token usage since code generation isn't needed.

## Build with MCP

**Display name:** Build with MCP
**Description:** Like Build, but can use tools (MCP) to generate code

Build with MCP (also called "Agent Mode" in the codebase) combines code generation with the ability to use external tools and services through the [Model Context Protocol](https://modelcontextprotocol.io/).

### What it can do

- Everything Build mode can do
- Access external tools and APIs via MCP
- Gather information from tools before writing code
- Determine what tools/APIs are needed for a task

### How it works

When you send a prompt in Build with MCP mode, the AI follows a two-phase approach:

1. **Information Gathering Phase** - Determines what tools are needed and gathers information
2. **Code Generation Phase** - Uses the gathered information to generate code

This ensures the AI has all the context it needs before writing any code.

### When to use it

Build with MCP is ideal for tasks that require:
- External API integration
- Database queries
- Web searches or external data
- Multi-step workflows involving external tools

## Agent (Experimental)

**Display name:** Agent
**Description:** Better at bigger tasks and debugging
**Requirements:** Dyad Pro subscription

Agent mode (also called "Local Agent" or "Agent v2") is the most advanced chat mode available. It uses a tool-based architecture with parallel execution capabilities to handle complex, multi-step tasks more effectively.

### What it can do

- Everything Build mode can do
- Use a comprehensive set of specialized tools
- Execute multiple tools in parallel
- Intelligently break down complex tasks
- Advanced debugging capabilities
- Better at handling multi-file changes

### How it differs from other modes

Unlike the pseudo tool-calling approach used in Build mode (with `<dyad-*>` XML-like tags), Agent mode uses formal tool calling capabilities. This allows for:

- Parallel tool execution for faster results
- More sophisticated planning and execution
- Better error handling and recovery
- Iterative problem-solving

The architecture is described in more detail in the [Agent Architecture](./agent_architecture.md) documentation.

### When to use it

Agent mode excels at:
- Large, multi-step refactorings
- Complex debugging scenarios
- Tasks spanning multiple files and systems
- Problems that require planning and iteration

### Important notes

- Agent mode is **experimental** and requires a Dyad Pro subscription
- When switching to Agent mode in an existing chat with messages, you'll see a warning toast (this can be dismissed permanently)
- Agent mode has its own specialized [system prompt](https://github.com/dyad-sh/dyad/blob/main/src/prompts/local_agent_prompt.ts) and [tool definitions](https://github.com/dyad-sh/dyad/blob/main/src/pro/main/ipc/handlers/local_agent/tool_definitions.ts)

## Comparison Table

| Feature | Build | Ask | Build with MCP | Agent |
|---------|-------|-----|----------------|-------|
| Code Generation | ✅ | ❌ | ✅ | ✅ |
| File Editing | ✅ | ❌ | ✅ | ✅ |
| Explanations | ✅ | ✅ | ✅ | ✅ |
| External Tools (MCP) | ❌ | ❌ | ✅ | ✅ |
| Parallel Execution | ❌ | ❌ | ❌ | ✅ |
| Turbo Edits v2 | ✅ | N/A | ❌ | N/A |
| Auto-fix Problems | ✅ | N/A | ❌ | N/A |
| Requires Pro | ❌ | ❌ | ❌ | ✅ |
| Best For | General coding | Learning | Tool-based tasks | Complex projects |

## FAQ

### Can I switch modes mid-conversation?

Yes! You can switch chat modes at any time. Your conversation history is preserved, though some modes may handle it differently (for example, Ask mode strips out `<dyad-*>` tags from history to save tokens).

### Why doesn't Build mode use formal tool calling?

Build mode uses XML-like `<dyad-*>` tags instead of formal tool calling for two main reasons:

1. You can call many tools at once in a single response
2. There's [evidence](https://aider.chat/2024/08/14/code-in-json.html) that forcing LLMs to return code in JSON (which tool calling requires) can negatively affect code quality

However, the Agent mode does use formal tool calling since modern models have gotten much better at it, especially with parallel tool calling.

### Which mode should I use?

For most tasks, **Build mode** is the right choice. It's fast, cost-effective, and handles the majority of coding tasks well.

Use **Ask mode** when you want to understand something without making changes.

Use **Build with MCP** when your task requires external tools or APIs that you've configured via MCP.

Use **Agent mode** for complex, multi-step tasks where you need the AI to do more planning and iteration. Keep in mind this mode can be more expensive due to multiple tool calls.

### How do I enable Agent mode?

Agent mode requires a Dyad Pro subscription. Once you have Pro, it will appear as an option in the chat mode selector.

### Where is my selected mode saved?

Your selected chat mode is saved in your user settings and persists across sessions. The default mode is Build.

### Can I use keyboard shortcuts to switch modes?

Yes! Press `Ctrl+.` (Windows/Linux) or `Cmd+.` (Mac) to cycle through the available modes. The modes cycle in this order: Build → Ask → Build with MCP → Agent (if Pro enabled) → back to Build.

## Implementation Details

For developers interested in how chat modes work under the hood:

- **Mode Schema**: Defined in [`src/lib/schemas.ts`](https://github.com/dyad-sh/dyad/blob/main/src/lib/schemas.ts)
- **UI Component**: [`src/components/ChatModeSelector.tsx`](https://github.com/dyad-sh/dyad/blob/main/src/components/ChatModeSelector.tsx)
- **Toggle Hook**: [`src/hooks/useChatModeToggle.ts`](https://github.com/dyad-sh/dyad/blob/main/src/hooks/useChatModeToggle.ts)
- **System Prompts**: [`src/prompts/system_prompt.ts`](https://github.com/dyad-sh/dyad/blob/main/src/prompts/system_prompt.ts) (Build, Ask, Build with MCP)
- **Agent Prompt**: [`src/prompts/local_agent_prompt.ts`](https://github.com/dyad-sh/dyad/blob/main/src/prompts/local_agent_prompt.ts)
- **Chat Stream Handler**: [`src/ipc/handlers/chat_stream_handlers.ts`](https://github.com/dyad-sh/dyad/blob/main/src/ipc/handlers/chat_stream_handlers.ts)
- **Local Agent Handler**: [`src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts`](https://github.com/dyad-sh/dyad/blob/main/src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts)

For more information on the Agent mode architecture, see [Agent Architecture](./agent_architecture.md).
