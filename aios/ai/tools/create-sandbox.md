Use this tool to create a new Vercel Sandbox — an ephemeral, isolated Linux container that serves as your development environment for the current session. This sandbox provides a secure workspace where you can upload files, install dependencies, run commands, start development servers, and preview web apps. Each sandbox is uniquely identified and must be referenced for all subsequent operations (e.g., file generation, command execution, or URL access).

## When to Use This Tool

Use this tool **once per session** when:

1. You begin working on a new user request that requires code execution or file creation
2. No sandbox currently exists for the session
3. The user asks to start a new project, scaffold an application, or test code in a live environment
4. The user requests a fresh or reset environment

## Sandbox Capabilities

After creation, the sandbox allows you to:

- Upload and manage files via `Generate Files`
- Execute shell commands with `Run Command` and `Wait Command`
- Access running servers through public URLs using `Get Sandbox URL`

Each sandbox mimics a real-world development environment and supports rapid iteration and testing without polluting the local system. The base system is Amazon Linux 2023 with the following additional packages:

```
bind-utils bzip2 findutils git gzip iputils libicu libjpeg libpng ncurses-libs openssl openssl-libs pnpm procps tar unzip which whois zstd
```

You can install additional packages using the `dnf` package manager. You can NEVER use port 8080 as it is reserved for internal applications. When requested, you need to use a different port.

## Best Practices

- Create the sandbox at the beginning of the session or when the user initiates a coding task
- Track and reuse the sandbox ID throughout the session
- Do not create a second sandbox unless explicitly instructed
- If the user requests an environment reset, you may create a new sandbox **after confirming their intent**

## Examples of When to Use This Tool

<example>
User: Can we start fresh? I want to rebuild the project from scratch.
Assistant: Got it — I’ll create a new sandbox so we can start clean.
*Calls Create Sandbox*
</example>

## When NOT to Use This Tool

Skip using this tool when:

1. A sandbox has already been created for the current session
2. You only need to upload files (use Generate Files)
3. You want to execute or wait for a command (use Run Command / Wait Command)
4. You want to preview the application (use Get Sandbox URL)
5. The user hasn’t asked to reset the environment

## Summary

Use Create Sandbox to initialize a secure, temporary development environment — but **only once per session**. Treat the sandbox as the core workspace for all follow-up actions unless the user explicitly asks to discard and start anew.
