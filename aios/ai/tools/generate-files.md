Use this tool to generate and upload code files into an existing Vercel Sandbox. It leverages an LLM to create file contents based on the current conversation context and user intent, then writes them directly into the sandbox file system.

The generated files should be considered correct on first iteration and suitable for immediate use in the sandbox environment. This tool is essential for scaffolding applications, adding new features, writing configuration files, or fixing missing components.

All file paths must be relative to the sandbox root (e.g., `src/index.ts`, `package.json`, `components/Button.tsx`).

## When to Use This Tool

Use Generate Files when:

1. You need to create one or more new files as part of a feature, scaffold, or fix
2. The user requests code that implies file creation (e.g., new routes, APIs, components, services)
3. You need to bootstrap a new application structure inside a sandbox
4. You’re completing a multi-step task that involves generating or updating source code
5. A prior command failed due to a missing file, and you need to supply it

## File Generation Guidelines

- Every file must be complete, valid, and runnable where applicable
- File contents must reflect the user’s intent and the overall session context
- File paths must be well-structured and use consistent naming conventions
- Generated files should assume compatibility with other existing files in the sandbox

## Best Practices

- Avoid redundant file generation if the file already exists and is unchanged
- Use conventional file/folder structures for the tech stack in use
- If replacing an existing file, ensure the update fully satisfies the user’s request

## Examples of When to Use This Tool

<example>
User: Add a `NavBar.tsx` component and include it in `App.tsx`
Assistant: I’ll generate the `NavBar.tsx` file and update `App.tsx` to include it.
*Uses Generate Files to create:*
- `components/NavBar.tsx`
- Modified `App.tsx` with import and usage of `NavBar`
</example>

<example>
User: Let’s scaffold a simple Express server with a `/ping` route.
Assistant: I’ll generate the necessary files to start the Express app.
*Uses Generate Files to create:*
- `package.json` with Express as a dependency
- `index.js` with basic server and `/ping` route
</example>

## When NOT to Use This Tool

Avoid using this tool when:

1. You only need to execute code or install packages (use Run Command instead)
2. You’re waiting for a command to finish (use Wait Command)
3. You want to preview a running server or UI (use Get Sandbox URL)
4. You haven’t created a sandbox yet (use Create Sandbox first)

## Output Behavior

After generation, the tool will return a list of the files created, including their paths and contents. These can then be inspected, referenced, or used in subsequent commands.

## Summary

Use Generate Files to programmatically create or update files in your Vercel Sandbox. It enables fast iteration, contextual coding, and dynamic file management — all driven by user intent and conversation context.
