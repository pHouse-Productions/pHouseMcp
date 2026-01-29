# pHouseMcp - MCP Servers

This repo contains the MCP (Model Context Protocol) servers used by Claude Code.

## Critical: Rebuild After Changes

**After modifying ANY TypeScript file, you MUST rebuild:**

```bash
npm run build
```

This compiles TypeScript to JavaScript. The MCP servers run from the compiled `dist/mcp.js` files, NOT the TypeScript source.

If you skip this step, your changes won't take effect until someone rebuilds.

## Quick Reference

| Action | Command |
|--------|---------|
| Rebuild everything | `npm run build` |
| Rebuild one server | `cd servers/telegram && npm run build` |
| Add dependencies | `npm install` then `npm run build` |

## Structure

```
packages/           # Shared libs (build first)
├── common/         # Utility functions
└── google-auth/    # Google OAuth client

servers/            # Individual MCP servers
├── telegram/
├── gmail/
├── google-docs/
├── google-sheets/
├── google-drive/
├── google-places/
├── google-calendar/
├── google-chat/
├── image-gen/
├── yahoo-finance/
├── cron/
├── memory/
├── pdf/
└── playwright/
```

## Adding a New Server

1. Create directory: `servers/your-server/`
2. Add files: `src/mcp.ts`, `package.json`, `tsconfig.json` (copy from existing server)
3. Add to root `package.json`:
   - Add to `workspaces` array
   - Add to `scripts.build` command
4. Run `npm install && npm run build`
5. Add server config to `~/.claude.json` mcpServers section using `node dist/mcp.js`

## Where Servers Are Configured

The Claude config lives at `~/.claude.json`. Each server entry looks like:

```json
"telegram": {
  "type": "stdio",
  "command": "node",
  "args": ["/home/ubuntu/pHouseMcp/servers/telegram/dist/mcp.js"],
  "env": { "TELEGRAM_BOT_TOKEN": "..." }
}
```

**Use `node dist/mcp.js`** (compiled JS), not `npx tsx src/mcp.ts` (slower TypeScript compilation on each startup).
