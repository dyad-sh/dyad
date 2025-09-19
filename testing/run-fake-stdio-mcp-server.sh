#!/usr/bin/env bash
set -euo pipefail

# Launch the fake stdio MCP server with Node.
# Usage: testing/run-fake-stdio-mcp-server.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="node"

exec "$NODE_BIN" "$SCRIPT_DIR/fake-stdio-mcp-server.mjs"


