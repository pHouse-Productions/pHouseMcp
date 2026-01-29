# pHouse MCP

A collection of modular MCP (Model Context Protocol) servers for Claude and other AI assistants.

## Structure

```
pHouseMcp/
├── packages/           # Shared libraries
│   ├── common/         # Common utilities (file ops, schemas)
│   └── google-auth/    # Shared Google OAuth client
├── servers/            # Individual MCP servers
│   ├── telegram/       # Telegram messaging
│   ├── gmail/          # Gmail read/send
│   ├── google-docs/    # Google Docs CRUD
│   ├── google-sheets/  # Google Sheets CRUD
│   ├── google-drive/   # Google Drive file management
│   ├── google-places/  # Google Places search
│   ├── image-gen/      # AI image generation (OpenRouter/Gemini)
│   ├── yahoo-finance/  # Stock quotes and data
│   ├── cron/           # Scheduled tasks
│   └── memory/         # Persistent notes and memory
└── .env                # API keys and credentials
```

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/mcarcaso/pHouseMcp.git
   cd pHouseMcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build all servers (compiles TypeScript to JavaScript):
   ```bash
   npm run build
   ```

4. Create `.env` file from example:
   ```bash
   cp .env.example .env
   ```

5. Configure your credentials in `.env` (see below)

## Configuration

### Required Environment Variables

```env
# For image-gen server
OPENROUTER_API_KEY=your_openrouter_key

# For telegram server
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# For google-places server
GOOGLE_PLACES_API_KEY=your_google_places_key

# For Google services (gmail, docs, sheets, drive)
GOOGLE_CREDENTIALS_PATH=/path/to/client_secret.json
GOOGLE_TOKEN_PATH=/path/to/tokens.json
```

### Google OAuth Setup

1. Create a project in Google Cloud Console
2. Enable the APIs you need (Gmail, Docs, Sheets, Drive, Calendar, Chat)
3. Create OAuth 2.0 credentials (Desktop app)
4. Download as `client_secret.json`
5. Run the auth flow to get `tokens.json` (one-time setup)

**Required OAuth Scopes:**

The auth flow should request these scopes (depending on which services you use):
- `https://mail.google.com/` - Gmail full access
- `https://www.googleapis.com/auth/gmail.settings.basic` - Gmail filter management
- `https://www.googleapis.com/auth/gmail.settings.sharing` - Gmail forwarding settings
- `https://www.googleapis.com/auth/calendar` - Google Calendar
- `https://www.googleapis.com/auth/documents` - Google Docs
- `https://www.googleapis.com/auth/spreadsheets` - Google Sheets
- `https://www.googleapis.com/auth/drive` - Google Drive
- `https://www.googleapis.com/auth/presentations` - Google Slides
- `https://www.googleapis.com/auth/chat.spaces` - Google Chat spaces
- `https://www.googleapis.com/auth/chat.messages` - Google Chat messages
- `https://www.googleapis.com/auth/chat.memberships` - Google Chat memberships

**Note for Google Chat:** If using the Chat API, you must also configure a Chat app in the Google Cloud Console under APIs & Services > Google Chat API > Configuration. This is required even when using user authentication. See the pHouseClawd README for detailed setup instructions.

## Adding to Claude

**Important:** Servers are pre-compiled to JavaScript for faster startup. Make sure you've run `npm run build` first.

Each server can be added to Claude. Edit `~/.claude.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/pHouseMcp/servers/telegram/dist/mcp.js"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your_token"
      }
    }
  }
}
```

**Note:** We use `node dist/mcp.js` (compiled JavaScript) instead of `npx tsx src/mcp.ts` (TypeScript) for faster MCP startup times.

## Servers

### telegram
Send and receive Telegram messages, photos, and documents.

### gmail
Fetch, read, and send emails via Gmail API. Manage Gmail filters.

**Tools:**
- `fetch_emails` - Fetch recent emails from inbox
- `read_email` - Read full email content by ID
- `send_email` - Send emails with optional attachments
- `list_filters` - List all Gmail filters
- `create_filter` - Create filters (forward, star, archive, etc.)
- `delete_filter` - Delete a filter by ID

**Note:** To create filters with forwarding, you must first verify the forwarding address in Gmail settings (Settings → Forwarding and POP/IMAP → Add a forwarding address).

### google-docs
Create, read, and edit Google Docs.

### google-sheets
Create, read, write, and append to Google Sheets.

### google-drive
Search, upload, delete, and share files in Google Drive.

### google-places
Search for businesses and get place details.

### image-gen
Generate and edit images using OpenRouter's Gemini models.

### yahoo-finance
Get stock quotes, historical data, and company profiles.

### cron
Schedule recurring and one-time tasks.

### memory
Persistent notes and memory across sessions.

## Development

### Making Changes

After modifying any TypeScript files, you **must rebuild** for the changes to take effect:

```bash
# Rebuild everything (packages first, then servers)
npm run build

# Or rebuild a specific server
cd servers/telegram && npm run build
```

### Project Structure

- **packages/** - Shared libraries that servers depend on
  - `common/` - Utility functions
  - `google-auth/` - Shared Google OAuth client
- **servers/** - Individual MCP servers, each with:
  - `src/mcp.ts` - Source TypeScript
  - `dist/mcp.js` - Compiled JavaScript (after build)
  - `tsconfig.json` - TypeScript config

### Build Order

The build runs in order: `packages/common` → `packages/google-auth` → all servers. This is handled automatically by the root `npm run build` script.

### Adding a New Server

1. Create `servers/your-server/` with `src/mcp.ts`, `package.json`, `tsconfig.json`
2. Add it to the root `package.json` workspaces
3. Add it to the build script in root `package.json`
4. Run `npm install && npm run build`
5. Add to `~/.claude.json` mcpServers section

## License

MIT
