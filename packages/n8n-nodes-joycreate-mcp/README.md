# n8n-nodes-joycreate-mcp

n8n community node that lets workflows invoke any tool from any MCP server
configured in [JoyCreate](https://github.com/DisciplesofLove/JoyCreate)'s
**MCP Hub**. One node, every MCP server you've already wired up — GitHub,
Slack, Notion, Postgres, Brave Search, Filesystem, Puppeteer, anything.

## How it works

The JoyCreate desktop app already runs a local HTTP API on
`http://127.0.0.1:18793` (auth via a bearer token written to
`~/.openclaw/joycreate-api-token`). This node calls four routes on that
API:

- `POST /api/mcp/list-servers`   → your enabled MCP servers
- `POST /api/mcp/list-tools`     → tool catalog (cross-server or per-server)
- `POST /api/mcp/call-tool`      → invoke a tool
- `POST /api/mcp/list-resources` → list resources for a server

Each route forwards into the existing in-process `mcp:*` IPC handlers, so
consent rules, server lifecycle, and MCP transport stay exactly as they
are in the desktop app.

## Install

### Production (npm)

```bash
npm install n8n-nodes-joycreate-mcp
```

Then restart n8n. The **JoyCreate MCP** node will appear in the node
catalog under "AI / Productivity".

### Local dev / testing

From this directory:

```bash
npm install
npm run build
npm link
# then in your n8n custom dir:
npm link n8n-nodes-joycreate-mcp
```

## Credentials

Create a **JoyCreate API** credential in n8n:

| Field        | Value                                                                  |
|--------------|------------------------------------------------------------------------|
| Server URL   | `http://127.0.0.1:18793` (default)                                     |
| API Token    | Contents of `~/.openclaw/joycreate-api-token`                          |

The credential test hits `/api/mcp/list-servers` to confirm the token is
valid.

## Operations

### Call Tool
Invoke a specific MCP tool by `serverId` and tool name with JSON
arguments. The response is the tool result as returned by the MCP
server. Errors are surfaced normally so workflows can branch on them.

### List Tools
Returns the cross-server tool catalog (when `Server ID` is left at 0)
or the tool list for a single server.

### List Servers
Returns the configured MCP servers, including their numeric IDs (which
you'll need for `Call Tool` and `List Resources`).

### List Resources
Returns the resource list for one MCP server.

## Example workflow

> _"When a GitHub issue is opened, fetch its referenced repo metadata
> via the MCP filesystem server, then summarise via the LLM agent."_

1. **GitHub Trigger** → on issue opened
2. **JoyCreate MCP** → operation `Call Tool`, server `1` (filesystem),
   tool `read_file`, args `{ "path": "{{$json.body.repo.path}}/README.md" }`
3. **OpenAI** → summarise the file content
4. **GitHub** → comment the summary on the issue

## License

MIT — see `package.json`.
