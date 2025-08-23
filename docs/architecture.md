# Dyad Architecture

This doc describes how the Dyad desktop app works at a high-level. If something is out of date, please feel free to suggest a change via a pull request.

## Overview

Dyad is an Electron app that is a local, open-source alternative to AI app builders like Lovable, v0, and Bolt. While the specifics of how other AI app builders are constructed aren't publicly documented, there is available information like [system prompts](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) about these other app builders.

## Electron Architecture

If you're not familiar with Electron apps, they are similar to a full-stack JavaScript app where there's a client-side called the **renderer process** which executes the UI code like React and then there's a Node.js process called the **main process** which is comparable to the server-side portion of a full-stack app. The main process is privileged, meaning it has access to the filesystem and other system resources, whereas the renderer process is sandboxed. The renderer process can communicate to the main process using [IPCs](https://en.wikipedia.org/wiki/Inter-process_communication) which is similar to how the browser communicates to the server using HTTP requests.

## Life of a request

The core workflow of Dyad is that a user sends a prompt to the AI which edits the code and is reflected in the preview. We'll break this down step-by-step.

1. **Constructing an LLM request** - the LLM request that Dyad sends consists of much more than the prompt (i.e. user input). It includes, by default, the entire codebase as well as a detailed [system prompt](https://github.com/dyad-sh/dyad/blob/main/src/prompts/system_prompt.ts) which gives the LLM instructions to respond in a specific XML-like format (e.g. `<dyad-write path="path/to/file.ts">console.log("hi")</dyad-write>`).
2. **Stream the LLM response to the UI** - It's important to provide visual feedback to the user otherwise they're waiting for several minutes without knowing what's happening so we stream the LLM response and show the LLM response. We have a specialized [Markdown parser](https://github.com/dyad-sh/dyad/blob/main/src/components/chat/DyadMarkdownParser.tsx) which parses these `<dyad-*>` tags like the `<dyad-write>` tag shown earlier, so we can display the LLM output in a nice UI rather than just printing out raw XML-like text.
3. **Process the LLM response** - Once the LLM response has finished, and the user has approved the changes, the [response processor](https://github.com/dyad-sh/dyad/blob/main/src/ipc/processors/response_processor.ts) in the main process applies these changes. Essentially each `<dyad-*>` tag described in the [system prompt](https://github.com/dyad-sh/dyad/blob/main/src/prompts/system_prompt.ts) maps to specific logic in the response processor, e.g. writing a file, deleting a file, adding a new NPM package, etc.

To recap, Dyad essentially tells the LLM about a bunch of tools like writing files using the `<dyad-*>` tags, the renderer process displays these Dyad tags in a nice UI and the main process executes these Dyad tags to apply the changes.

## FAQ

### Why not use actual tool calls?

One thing that may seem strange is that we don't use actual function calling/tool calling capabilities of the AI and instead use these XML-like syntax which simulate tool calling. This is something I observed from studying the [system prompts](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) of other app builders.

I think the two main reasons to use this XML-like format instead of actual tool calling is that:

1. You can call many tools at once, although some models allow [parallel calls](https://platform.openai.com/docs/guides/function-calling/parallel-function-calling#parallel-function-calling), many don't.
2. There's also [evidence](https://aider.chat/2024/08/14/code-in-json.html) that forcing LLMs to return code in JSON (which is essentially what tool calling would entail here) negatively affects the quality.

However, many AI editors _do_ heavily rely on tool calling and this is something that we're evaluating, particularly with upcoming MCP support.

### Why isn't Dyad more agentic?

Many other systems (e.g. Cursor) are much more agentic than Dyad. For example, they will call many tools and do things like create a plan, use command-line tools to search through the codebase, run linters and tests and automatically fix the code based on those output.

Dyad, on the other hand, has a relatively simple agentic loop. We will fix TypeScript compiler errors if Auto-fix problems is enabled, but otherwise it's usually a single request to the AI.

The biggest issue with complex agentic workflows is that they can get very expensive very quickly! It's not uncommon to see users report spending a few dollars with a single request because under the hood, that single user requests turns into dozens of LLM requests. To keep Dyad as cost-efficient as possible, we've avoided complex agentic workflows at least until the cost of LLMs is more affordable.

### Why does Dyad send the entire codebase with each AI request?

Sending the right context to the AI has been rightfully emphasized as important, so much so that the term ["context engineering"](https://www.philschmid.de/context-engineering) is now in vogue.

Sending the entire codebase is the simplest approach and quite effective for small codebases. Another approach is for the user to explicitly select the part of the codebase to use as context. This can be done through the [select component](https://www.dyad.sh/docs/releases/0.8.0) feature or [manual context management](https://www.dyad.sh/docs/guides/large-apps#manual-context-management).

However, both of these approaches require users to manually select the right files which isn't always practical. Dyad's [Smart Context](https://www.dyad.sh/docs/guides/ai-models/pro-modes#smart-context) feature essentially uses smaller models to filter out the most important files in the given chat. That said, we are constantly experimenting with new approaches to context selection as it's quite a difficult problem.

One approach that we don't use is a more agentic-style like what Claude Code and Cursor does where it iteratively searches and navigates through a codebase using tool calls. The main reason we don't do this is due to cost (see the above question: [Why isn't Dyad more agentic](#why-isnt-dyad-more-agentic)).
