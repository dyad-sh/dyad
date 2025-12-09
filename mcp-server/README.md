# Dyad MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes Dyad's AI app building capabilities to other AI agents and tools.

## Overview

This MCP server allows AI assistants like Claude Desktop to interact with your Dyad apps through a standardized protocol. You can query apps, read code, inspect chat history, and explore version control - all through natural language.

## Features

### 🚀 App Management
- **dyad_list_apps** - List all Dyad apps
- **dyad_get_app** - Get detailed app information
- **dyad_search_apps** - Search apps by name
- **dyad_get_app_structure** - Get app file/folder structure

### 💬 Chat Management
- **dyad_list_chats** - List all chats (optionally filtered by app)
- **dyad_get_chat** - Get chat details with messages
- **dyad_search_chats** - Search chats by title
- **dyad_get_chat_messages** - Get all messages from a chat

### 📁 File Operations
- **dyad_read_file** - Read file contents from an app
- **dyad_list_files** - List files in an app (with filters)

### 🔄 Version Control
- **dyad_get_git_status** - Get Git status and changes
- **dyad_get_git_log** - Get commit history

## Installation

### From the Dyad repository

```bash
cd dyad-1/mcp-server
npm install
npm run build
```

### Configuration

#### For Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": [
        "<path-to-dyad>\\mcp-server\\dist\\index.js"
      ]
    }
  }
}
```

Remplacez `<path-to-dyad>` par le chemin complet vers votre installation Dyad.

Exemple :
```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": [
        "C:\\dyad-1\\mcp-server\\dist\\index.js"
      ]
    }
  }
}
```

#### For Other MCP Clients

The server uses stdio transport, so configure it according to your MCP client's documentation, pointing to:
```
node /path/to/dyad-1/mcp-server/dist/index.js
```

## Usage Examples

Once configured, you can interact with Dyad through your MCP client:

### List all apps
> "Show me all my Dyad apps"

### Inspect an app
> "What's the structure of app 5?"

### Read code
> "Show me the contents of src/index.ts in app 3"

### Search files
> "List all TypeScript files in app 2"

### View chat history
> "Show me the latest chats for app 1"

### Check Git status
> "What's the Git status of app 4?"

### View commit history
> "Show me the last 10 commits for app 3"

## Architecture

```
┌─────────────────────────────────────┐
│     MCP Client (e.g. Claude)        │
└──────────────┬──────────────────────┘
               │ stdio
┌──────────────▼──────────────────────┐
│       Dyad MCP Server               │
│  - Tool registration                │
│  - Request handling                 │
│  - Response formatting              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Dyad SQLite Database           │
│  - Apps, Chats, Messages            │
│  - Read-only access                 │
└─────────────────────────────────────┘
```

## Database Access

The server connects to Dyad's SQLite database in **read-only** mode:

- **macOS**: `~/Library/Application Support/dyad/dyad.db`
- **Windows**: `%APPDATA%/dyad/dyad.db`
- **Linux**: `~/.config/dyad/dyad.db`

## Security

- ✅ Read-only database access
- ✅ Path traversal protection
- ✅ No write operations
- ✅ No process execution
- ✅ Limited to Dyad's app directories

## Development

### Build
```bash
npm run build
```

### Watch mode
```bash
npm run dev
```

### Test with MCP Inspector
```bash
npm run inspector
```

## Troubleshooting

### Database not found
Make sure Dyad has been installed and run at least once. The database is created on first launch.

### Permission errors
Ensure the MCP server process has read access to:
- Dyad's database file
- App directories

### Connection issues
Check that:
1. The path in your MCP client config is correct
2. Node.js is installed and accessible
3. The server built successfully (`npm run build`)

## Tools Reference

### App Tools

#### dyad_list_apps
Lists all Dyad apps with metadata.

**Parameters**: None

**Returns**: Array of apps with id, name, path, creation dates, and favorite status.

#### dyad_get_app
Get detailed information about a specific app.

**Parameters**:
- `appId` (number): The app ID

**Returns**: App details including whether the path exists on disk.

#### dyad_search_apps
Search for apps by name.

**Parameters**:
- `query` (string): Search term

**Returns**: Matching apps.

#### dyad_get_app_structure
Get the file/folder tree of an app.

**Parameters**:
- `appId` (number): The app ID
- `maxDepth` (number, optional): Max traversal depth (default: 5)

**Returns**: Hierarchical structure excluding node_modules, .git, etc.

### Chat Tools

#### dyad_list_chats
List all chats, optionally filtered by app.

**Parameters**:
- `appId` (number, optional): Filter by app ID

**Returns**: Array of chats with id, title, appId, creation date.

#### dyad_get_chat
Get chat details including messages.

**Parameters**:
- `chatId` (number): The chat ID
- `includeMessages` (boolean, optional): Include messages (default: true)

**Returns**: Chat details with messages array.

#### dyad_search_chats
Search chats by title.

**Parameters**:
- `query` (string): Search term
- `appId` (number, optional): Filter by app ID

**Returns**: Matching chats.

#### dyad_get_chat_messages
Get all messages from a chat.

**Parameters**:
- `chatId` (number): The chat ID
- `limit` (number, optional): Max messages to return

**Returns**: Array of messages in chronological order.

### File Tools

#### dyad_read_file
Read a file's contents.

**Parameters**:
- `appId` (number): The app ID
- `filePath` (string): Relative path within app

**Returns**: File content, size, line count, last modified date.

#### dyad_list_files
List files in an app or directory.

**Parameters**:
- `appId` (number): The app ID
- `directory` (string, optional): Subdirectory (default: root)
- `recursive` (boolean, optional): Recurse subdirectories (default: true)
- `extensions` (string[], optional): Filter by extensions (e.g., ['.ts', '.tsx'])

**Returns**: Array of files with paths, sizes, types, last modified.

### Version Tools

#### dyad_get_git_status
Get Git status including changes and current commit.

**Parameters**:
- `appId` (number): The app ID

**Returns**: Current branch, commit info, file changes (modified, added, deleted, untracked).

#### dyad_get_git_log
Get commit history.

**Parameters**:
- `appId` (number): The app ID
- `limit` (number, optional): Max commits (default: 20)

**Returns**: Array of commits with messages, authors, timestamps.

## License

MIT - Same as Dyad (Apache 2.0 for core, FSL 1.1 for pro features)

## Contributing

Contributions are welcome! Please follow Dyad's contributing guidelines.

## Links

- [Dyad](https://dyad.sh)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP Specification](https://spec.modelcontextprotocol.io)
