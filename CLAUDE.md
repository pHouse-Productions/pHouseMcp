# pHouseMcp - MCP Gateway

Single gateway server hosting multiple MCP servers on different paths.

## Quick Start

```bash
# Build
npm run build

# Run (defaults to port 3000)
node dist/gateway.js

# Run with specific port
node dist/gateway.js --port 8080

# Dev mode (auto-recompile)
npm run dev
```

## Environment Variables

Set in `.env`:

```bash
# Required for remote access (ngrok, etc)
MCP_PUBLIC_URL=https://your-ngrok-url.app

# OAuth auth (optional but recommended for remote)
MCP_AUTH_CLIENT_ID=your-client-id
MCP_AUTH_CLIENT_SECRET=your-secret

# Server-specific (only needed for servers you want to use)
OPENROUTER_API_KEY=...      # image-gen
TELEGRAM_BOT_TOKEN=...      # telegram
FINNHUB_API_KEY=...         # finnhub
GOOGLE_PLACES_API_KEY=...   # google-places
# cron has no requirements
```

## Endpoints

Each server is mounted at its own path:

- `/image-gen/mcp` - AI image generation (requires OPENROUTER_API_KEY)
- `/telegram/mcp` - Telegram bot (requires TELEGRAM_BOT_TOKEN)
- `/cron/mcp` - Scheduled tasks (no token needed)
- `/finnhub/mcp` - Stock data (requires FINNHUB_API_KEY)
- `/google-places/mcp` - Places search (requires GOOGLE_PLACES_API_KEY)
- `/images/:id` - Serves generated images

Servers without their required tokens are automatically skipped.

## Structure

```
src/
  gateway.ts           # Main entry point
  lib/
    http-transport.ts  # HTTP/OAuth transport layer
  servers/
    image-gen.ts       # Image generation server
    telegram.ts        # Telegram bot server
    cron.ts            # Cron/scheduling server
    finnhub.ts         # Stock data server
    google-places.ts   # Places API server
```

## Adding a New Server

1. Create `src/servers/your-server.ts` exporting `createServer()`
2. Add it to `src/gateway.ts` serverConfigs array
3. `npm run build`
