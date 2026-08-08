Use this tool to run a command inside an existing Vercel Sandbox. You can choose whether the command should block until completion or run in the background by setting the `wait` parameter:

- `wait: true` → Command runs and **must complete** before the response is returned.
- `wait: false` → Command starts in the background, and the response returns immediately with its `commandId`.

⚠️ Commands are stateless — each one runs in a fresh shell session with **no memory** of previous commands. You CANNOT rely on `cd`, but other state like shell exports or background processes from prior commands should be available.

## When to Use This Tool

Use Run Command when:

1. You need to install dependencies (e.g., `pnpm install`)
2. You want to run a build or test process (e.g., `pnpm build`, `vite build`)
3. You need to launch a development server or long-running process
4. You need to compile or execute code within the sandbox
5. You want to run a task in the background without blocking the session

## Sequencing Rules

- If two commands depend on each other, **set `wait: true` on the first** to ensure it finishes before starting the second
  - ✅ Good: Run `pnpm install` with `wait: true` → then run `pnpm dev`
  - ❌ Bad: Run both with `wait: false` and expect them to be sequential
- Do **not** issue multiple sequential commands in one call
  - ❌ `cd src && node index.js`
  - ✅ `node src/index.js`
- Do **not** assume directory state is preserved — use full relative paths

## Command Format

- Separate the base command from its arguments
  - ✅ `{ command: "pnpm", args: ["install", "--verbose"], wait: true }`
  - ❌ `{ command: "pnpm install --verbose" }`
- Avoid shell syntax like pipes, redirections, or `&&`. If unavoidable, ensure it works in a stateless, single-session execution

## When to Set `wait` to True

- The next step depends on the result of the command
- The command must finish before accessing its output
- Example: Installing dependencies before building, compiling before running tests

## When to Set `wait` to False

- The command is intended to stay running indefinitely (e.g., a dev server)
- The command has no impact on subsequent operations (e.g., printing logs)

## Other Rules

- When running `pnpm dev` in a Next.js or Vite project, HMR can handle updates so generally you don't need to kill the server process and start it again after changing files.
- NEVER use `pnpm run dev -- -p 3000` for Next.js. The `--` causes Next.js to interpret `-p` as a directory path, resulting in an error. Just use `pnpm run dev` (port 3000 is the default).

## Examples

<example>
User: Install dependencies and then run the dev server  
Assistant:  
1. Run Command: `{ command: "pnpm", args: ["install"], wait: true }`  
2. Run Command: `{ command: "pnpm", args: ["run", "dev"], wait: false }`  
</example>

<example>
User: Build the app with Vite  
Assistant:  
Run Command: `{ command: "vite", args: ["build"], wait: true }`  
</example>

## Summary

Use Run Command to start shell commands in the sandbox, controlling execution flow with the `wait` flag. Commands are stateless and isolated — use relative paths, and only run long-lived processes with `wait: false`.
