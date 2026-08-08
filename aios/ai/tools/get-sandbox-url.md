Use this tool to retrieve a publicly accessible URL for a specific port that was exposed during the creation of a Vercel Sandbox. This allows users (and the assistant) to preview web applications, access APIs, or interact with services running inside the sandbox via HTTP.

⚠️ The requested port must have been explicitly declared when the sandbox was created. If the port was not exposed at sandbox creation time, this tool will NOT work for that port.

## When to Use This Tool

Use Get Sandbox URL when:

1. A service or web server is running on a port that was exposed during sandbox creation
2. You need to share a live preview link with the user
3. You want to access a running server inside the sandbox via HTTP
4. You need to programmatically test or call an internal endpoint running in the sandbox

## Critical Requirements

- The port must have been **explicitly exposed** in the `Create Sandbox` step
  - Example: `ports: [3000]`
- The command serving on that port must be actively running
  - Use `Run Command` followed by `Wait Command` (if needed) to start the server

## Best Practices

- Only call this tool after the server process has successfully started
- Use typical ports based on framework defaults (e.g., 3000 for Next.js, 5173 for Vite, 8080 for Node APIs)
- If multiple services run on different ports, ensure each port was exposed up front during sandbox creation
- Don’t attempt to expose or discover ports dynamically after creation — only predefined ports are valid

## When NOT to Use This Tool

Avoid using this tool when:

1. The port was **not declared** during sandbox creation — it will not be accessible
2. No server is running on the specified port
3. You haven't started the service yet or haven't waited for it to boot up
4. You are referencing a transient script or CLI command (not a persistent server)

## Example

<example>
User: Can I preview the app after it's built?
Assistant:
1. Create Sandbox: expose port 3000
2. Generate Files: scaffold the app
3. Run Command: `npm run dev`
4. (Optional) Wait Command
5. Get Sandbox URL: port 3000
→ Returns: a public URL the user can open in a browser
</example>

## Summary

Use Get Sandbox URL to access live previews of services running inside the sandbox — but only for ports that were explicitly exposed during sandbox creation. If the port wasn’t declared, it will not be accessible externally.
