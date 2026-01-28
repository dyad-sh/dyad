### Fake stdio MCP server

This directory contains a minimal stdio MCP server for local testing.

- **Tools**:
  - **calculator_add**: adds two numbers. Inputs: `a` (number), `b` (number).
  - **print_envs**: returns all environment variables visible to the server as pretty JSON.

### Requirements

- **Node 20+** (same as the repo engines)
- Uses the repo dependency `@modelcontextprotocol/sdk` and `zod`

### Launch

- **Via Node**:

  ```bash
  node testing/fake-stdio-mcp-server.mjs
  ```

- **Via script** (adds a stable entrypoint path):

  ```bash
  testing/run-fake-stdio-mcp-server.sh
  ```

### Passing environment variables

Environment variables provided when launching (either from your shell or by the app) will be visible to the `print_envs` tool.

```bash
export FOO=bar
export SECRET_TOKEN=example
testing/run-fake-stdio-mcp-server.sh
```

### Integrating with Dyad (stdio MCP)

When adding a stdio MCP server in the app, use:

- **Command**: `testing/run-fake-stdio-mcp-server.sh` (absolute path recommended)
- **Transport**: `stdio`
- **Args**: leave empty (not required)
- **Env**: optional key/values (e.g., `FOO=bar`)

Once connected, you should see the two tools listed:

- `calculator_add`
- `print_envs`

---

### Fake HTTP MCP server

This directory contains a minimal HTTP MCP server for local testing.

- **Tools**:
  - **calculator_add**: adds two numbers. Inputs: `a` (number), `b` (number).
  - **print_envs**: returns all environment variables visible to the server as pretty JSON.

### Requirements

- **Node 20+** (same as the repo engines)
- Uses Node.js built-in `http` module

### Launch

- **Via Node**:

  ```bash
  node testing/fake-http-mcp-server.mjs
  ```

- **Via script**:

  ```bash
  testing/run-fake-http-mcp-server.sh
  ```

### Configuration

- **Port**: defaults to `3002`, configurable via `PORT` environment variable

```bash
export PORT=3002
node testing/fake-http-mcp-server.mjs
```

### Integrating with Dyad (HTTP MCP)

When adding an HTTP MCP server in the app, use:

- **Name**: `testing-http-mcp-server` (or any name)
- **Transport**: `http`
- **URL**: `http://localhost:3002/mcp` (or your configured port)
- **Headers**: Optional. You can add custom headers (e.g., `Authorization: Bearer token`) if needed for testing.

Once connected, you should see the tools listed:

- `calculator_add`
- `print_envs`
