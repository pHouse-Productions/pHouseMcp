#!/bin/bash
# Switch MCP servers from stdio to HTTP mode
# Run: bash scripts/switch-to-http.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Switching MCP servers to HTTP mode ==="
echo ""

# Create logs directory
mkdir -p "$MCP_DIR/logs"

# Step 1: Install systemd service
echo "1. Installing systemd service..."
sudo cp "$MCP_DIR/mcp-servers.service" /etc/systemd/system/
sudo systemctl daemon-reload

# Step 2: Start the HTTP servers
echo "2. Starting MCP HTTP servers..."
sudo systemctl start mcp-servers
sudo systemctl enable mcp-servers
sleep 3

# Check if servers are running
echo "3. Checking server health..."
for port in 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010 3011 3012 3013 3014; do
  if curl -s "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
    echo "   Port $port: OK"
  else
    echo "   Port $port: FAIL"
  fi
done

# Step 3: Update Claude config
echo ""
echo "4. Updating Claude config..."

# Remove old stdio servers (keep playwright - it's third-party)
for name in memory cron gmail google-calendar google-docs google-drive google-places google-sheets telegram discord google-chat finnhub image-gen pdf; do
  claude mcp remove "$name" 2>/dev/null || true
done

echo "   Note: Keeping 'playwright' as stdio (third-party server)"

# Add HTTP servers to user config
claude mcp add -s user --transport http memory http://127.0.0.1:3001/mcp
claude mcp add -s user --transport http cron http://127.0.0.1:3002/mcp
claude mcp add -s user --transport http gmail http://127.0.0.1:3003/mcp
claude mcp add -s user --transport http google-calendar http://127.0.0.1:3004/mcp
claude mcp add -s user --transport http google-docs http://127.0.0.1:3005/mcp
claude mcp add -s user --transport http google-drive http://127.0.0.1:3006/mcp
claude mcp add -s user --transport http google-places http://127.0.0.1:3007/mcp
claude mcp add -s user --transport http google-sheets http://127.0.0.1:3008/mcp
claude mcp add -s user --transport http telegram http://127.0.0.1:3009/mcp
claude mcp add -s user --transport http discord http://127.0.0.1:3010/mcp
claude mcp add -s user --transport http google-chat http://127.0.0.1:3011/mcp
claude mcp add -s user --transport http finnhub http://127.0.0.1:3012/mcp
claude mcp add -s user --transport http image-gen http://127.0.0.1:3013/mcp
claude mcp add -s user --transport http pdf http://127.0.0.1:3014/mcp

echo ""
echo "=== Done! ==="
echo ""
echo "MCP servers are now running in HTTP mode."
echo "New Claude sessions will connect to shared servers instead of spawning new ones."
echo ""
echo "To check status: sudo systemctl status mcp-servers"
echo "To view logs: tail -f $MCP_DIR/logs/mcp-servers.log"
echo "To revert: bash scripts/switch-to-stdio.sh"
