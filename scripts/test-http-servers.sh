#!/bin/bash
# Test HTTP MCP servers health endpoints
# Run: bash scripts/test-http-servers.sh

echo "Testing MCP HTTP servers..."
echo ""

declare -A servers=(
  ["memory"]=3001
  ["cron"]=3002
  ["gmail"]=3003
  ["google-calendar"]=3004
  ["google-docs"]=3005
  ["google-drive"]=3006
  ["google-places"]=3007
  ["google-sheets"]=3008
  ["telegram"]=3009
  ["discord"]=3010
  ["google-chat"]=3011
  ["finnhub"]=3012
  ["image-gen"]=3013
  ["pdf"]=3014
)

all_ok=true
for name in "${!servers[@]}"; do
  port=${servers[$name]}
  response=$(curl -s "http://127.0.0.1:$port/health" 2>/dev/null)
  if [ $? -eq 0 ] && echo "$response" | grep -q '"status":"ok"'; then
    sessions=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('sessions', 0))" 2>/dev/null)
    echo "✓ $name (port $port) - ${sessions:-0} active sessions"
  else
    echo "✗ $name (port $port) - NOT RUNNING"
    all_ok=false
  fi
done

echo ""
if [ "$all_ok" = true ]; then
  echo "All servers are healthy!"
else
  echo "Some servers are not running. Start with: sudo systemctl start mcp-servers"
  exit 1
fi
