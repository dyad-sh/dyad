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
  - **Authorization**: requires an `Authorization` header with the expected value (default: `test-auth-token-123`, configurable via `EXPECTED_AUTH_VALUE` env var).

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

- **Port**: defaults to `3001`, configurable via `PORT` environment variable
- **Authorization**: defaults to `test-auth-token-123`, configurable via `EXPECTED_AUTH_VALUE` environment variable

```bash
export EXPECTED_AUTH_VALUE=my-secret-token
export PORT=3001
node testing/fake-http-mcp-server.mjs
```

### Integrating with Dyad (HTTP MCP)

When adding an HTTP MCP server in the app, use:

- **Name**: `testing-http-mcp-server` (or any name)
- **Transport**: `http`
- **URL**: `http://localhost:3001` (or your configured port)
- **Headers**: Add an `Authorization` header with the expected value (e.g., `test-auth-token-123`)

Once connected, you should see the tool listed:

- `calculator_add`

The server verifies the `Authorization` header on all requests. If the header is missing or incorrect, requests will be rejected with a 401 Unauthorized response.
