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

---

### Fake OAuth-protected MCP server

`fake-oauth-mcp-server.mjs` bundles a minimal OAuth 2.1 authorization
server (discovery, DCR, /authorize, /token, refresh) with a
Streamable-HTTP MCP endpoint behind a bearer-token check. Used to test
the Dyad MCP OAuth flow against a deterministic target rather than a
real provider like Linear.

The `/authorize` endpoint auto-redirects with a code (no consent UI),
so an automated test can drive the full flow without a browser. PKCE
S256 is enforced; refresh tokens rotate on use.

#### Env knobs

| Variable              | Default | Effect                                                                  |
| --------------------- | ------- | ----------------------------------------------------------------------- |
| `PORT`                | `4002`  | HTTP listen port                                                        |
| `FAKE_DCR`            | `1`     | `0` rejects `/register` (forces use of static client_id)                |
| `FAKE_CLIENT_ID`      | none    | Required when `FAKE_DCR=0`; the only client_id accepted by `/authorize` |
| `FAKE_CLIENT_SECRET`  | none    | When set, `/token` requires it in the body                              |
| `FAKE_REQUIRED_SCOPE` | none    | When set, `/authorize` 400s if scope missing                            |
| `FAKE_TOKEN_TTL_SEC`  | `3600`  | Access-token lifetime (set low to exercise refresh)                     |

#### Launch modes

DCR (mimics Linear/Atlassian/Notion):

```bash
testing/run-fake-oauth-mcp-server.sh
```

Static client_id (mimics non-DCR providers — the case real public MCPs
generally don't expose):

```bash
FAKE_DCR=0 FAKE_CLIENT_ID=my-test-client \
  testing/run-fake-oauth-mcp-server.sh
```

#### Wiring into Dyad (manual test)

Add an MCP server in the app with:

- **Transport**: `http`
- **URL**: `http://localhost:4002/mcp`
- **Use OAuth**: on
- **OAuth Client ID**: leave blank in DCR mode; paste `FAKE_CLIENT_ID` value in static mode
- **OAuth Scope**: `read` (or leave blank)

Click Connect — the auto-redirect completes silently and the
"OAuth: connected" badge should flip on. `calculator_add` and `whoami`
tools should appear.
