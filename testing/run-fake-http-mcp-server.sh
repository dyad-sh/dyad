#!/usr/bin/env bash
set -euo pipefail

# Launch the fake HTTP MCP server with Node.
# Usage: testing/run-fake-http-mcp-server.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="node"

exec "$NODE_BIN" "$SCRIPT_DIR/fake-http-mcp-server.mjs"

