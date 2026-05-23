#!/usr/bin/env bash
set -euo pipefail

# Launch the fake OAuth-protected MCP server with Node.
# Usage: testing/run-fake-oauth-mcp-server.sh
# Env knobs documented in testing/fake-oauth-mcp-server.mjs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="node"

exec "$NODE_BIN" "$SCRIPT_DIR/fake-oauth-mcp-server.mjs"
