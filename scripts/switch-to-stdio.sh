#!/bin/bash
# Revert MCP servers back to stdio mode
# Run: bash scripts/switch-to-stdio.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Reverting MCP servers to stdio mode ==="
echo ""

# Step 1: Stop HTTP servers
echo "1. Stopping MCP HTTP servers..."
sudo systemctl stop mcp-servers 2>/dev/null || true
sudo systemctl disable mcp-servers 2>/dev/null || true

# Step 2: Update Claude config back to stdio
echo "2. Updating Claude config..."

# Remove HTTP servers
for name in memory cron gmail google-calendar google-docs google-drive google-places google-sheets telegram discord google-chat finnhub image-gen pdf; do
  claude mcp remove "$name" 2>/dev/null || true
done

# Add back stdio servers
claude mcp add memory -- node "$MCP_DIR/servers/memory/dist/mcp.js"
claude mcp add cron -- node "$MCP_DIR/servers/cron/dist/mcp.js"
claude mcp add gmail -- node "$MCP_DIR/servers/gmail/dist/mcp.js"
claude mcp add google-calendar -- node "$MCP_DIR/servers/google-calendar/dist/mcp.js"
claude mcp add google-docs -- node "$MCP_DIR/servers/google-docs/dist/mcp.js"
claude mcp add google-drive -- node "$MCP_DIR/servers/google-drive/dist/mcp.js"
claude mcp add google-places -- node "$MCP_DIR/servers/google-places/dist/mcp.js"
claude mcp add google-sheets -- node "$MCP_DIR/servers/google-sheets/dist/mcp.js"
claude mcp add telegram -- node "$MCP_DIR/servers/telegram/dist/mcp.js"
claude mcp add discord -- node "$MCP_DIR/servers/discord/dist/mcp.js"
claude mcp add google-chat -- node "$MCP_DIR/servers/google-chat/dist/mcp.js"
claude mcp add finnhub -- node "$MCP_DIR/servers/finnhub/dist/mcp.js"
claude mcp add image-gen -- node "$MCP_DIR/servers/image-gen/dist/mcp.js"
claude mcp add pdf -- node "$MCP_DIR/servers/pdf/dist/mcp.js"

echo ""
echo "=== Done! ==="
echo ""
echo "MCP servers are now in stdio mode (each Claude session spawns its own)."
