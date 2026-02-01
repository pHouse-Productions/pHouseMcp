# pHouse MCP

A collection of modular MCP (Model Context Protocol) servers for Claude and other AI assistants.

## Structure

```
pHouseMcp/
├── packages/           # Shared libraries
│   ├── common/         # Common utilities (file ops, schemas)
│   ├── google-auth/    # Shared Google OAuth client
│   └── http-transport/ # HTTP transport for persistent MCP servers
├── servers/            # Individual MCP servers
│   ├── telegram/       # Telegram messaging + reactions
│   ├── gmail/          # Gmail read/send/filters
│   ├── discord/        # Discord messaging + reactions
│   ├── google-docs/    # Google Docs CRUD
│   ├── google-sheets/  # Google Sheets CRUD
│   ├── google-drive/   # Google Drive file management
│   ├── google-calendar/# Google Calendar events
│   ├── google-chat/    # Google Chat messaging + reactions
│   ├── google-places/  # Google Places search
│   ├── image-gen/      # AI image generation (OpenRouter/Gemini)
│   ├── finnhub/        # Stock quotes, news, and company data (Finnhub API)
│   ├── pdf/            # PDF to markdown/images conversion
│   └── cron/           # Scheduled tasks
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

6. **Recommended:** Enable HTTP mode for shared servers (see below)

## HTTP Mode (Recommended)

By default, Claude spawns each MCP server as a subprocess per session (~1.5GB RAM). HTTP mode runs all servers as a single shared systemd service.

### Enable HTTP Mode

```bash
bash scripts/switch-to-http.sh
```

This will:
1. Install the `mcp-servers` systemd service
2. Start all 13 HTTP servers (ports 3002-3014)
3. Update your Claude config to use HTTP transport

### Service Management

```bash
sudo systemctl status mcp-servers   # Check status
sudo systemctl restart mcp-servers  # Restart (after code changes)
sudo systemctl stop mcp-servers     # Stop all servers

# View logs
tail -f logs/mcp-servers.log

# Health check all servers
npm run http:test
```

### After Code Changes

When you modify MCP server code:
```bash
npm run build                        # Rebuild TypeScript
sudo systemctl restart mcp-servers   # Restart service
```

Active Claude sessions reconnect automatically.

### Revert to stdio Mode

```bash
bash scripts/switch-to-stdio.sh
```

### Port Mapping

| Server | Port |
|--------|------|
| cron | 3002 |
| gmail | 3003 |
| google-calendar | 3004 |
| google-docs | 3005 |
| google-drive | 3006 |
| google-places | 3007 |
| google-sheets | 3008 |
| telegram | 3009 |
| discord | 3010 |
| google-chat | 3011 |
| finnhub | 3012 |
| image-gen | 3013 |
| pdf | 3014 |

## Configuration

### Required Environment Variables

```env
# For image-gen server
OPENROUTER_API_KEY=your_openrouter_key

# For telegram server
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# For discord server
DISCORD_BOT_TOKEN=your_discord_bot_token

# For google-places server
GOOGLE_PLACES_API_KEY=your_google_places_key

# For Google services (gmail, docs, sheets, drive, calendar, chat)
GOOGLE_CREDENTIALS_PATH=/path/to/client_secret.json
GOOGLE_TOKEN_PATH=/path/to/tokens.json

# For finnhub server (stock data)
FINNHUB_API_KEY=your_finnhub_api_key
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
Send and receive Telegram messages, photos, and documents. Add and remove emoji reactions.

**Tools:**
- `get_history` - Get last N messages from a conversation
- `send_typing` - Show typing indicator
- `send_message` - Send a text message
- `send_document` - Send a file/document
- `send_photo` - Send a photo (renders inline)
- `add_reaction` - Add an emoji reaction to a message
- `remove_reaction` - Remove all bot reactions from a message

### gmail
Fetch, read, and send emails via Gmail API. Manage Gmail filters.

**Tools:**
- `fetch_emails` - Fetch recent emails from inbox
- `read_email` - Read full email content by ID
- `send_email` - Send emails with optional attachments and custom sender name (`from_name` parameter)
- `list_filters` - List all Gmail filters
- `create_filter` - Create filters (forward, star, archive, etc.)
- `delete_filter` - Delete a filter by ID

**Note:** To create filters with forwarding, you must first verify the forwarding address in Gmail settings (Settings → Forwarding and POP/IMAP → Add a forwarding address).

### discord
Send and receive Discord messages, files, and emoji reactions.

**Tools:**
- `get_history` - Get last N messages from a channel
- `send_typing` - Show typing indicator
- `send_message` - Send a text message
- `send_file` - Send a file with optional caption
- `add_reaction` - Add an emoji reaction to a message
- `remove_reaction` - Remove an emoji reaction

**Setup:**
1. Create a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable Message Content Intent in Bot settings
3. Add bot to your server with appropriate permissions
4. Add `DISCORD_BOT_TOKEN=your_token` to your `.env` file

### google-docs
Create, read, and edit Google Docs.

### google-sheets
Create, read, write, and append to Google Sheets.

### google-drive
Search, upload, delete, and share files in Google Drive.

**Tools:**
- `search_files` - Search for files by name
- `list_recent_files` - List recently modified files
- `upload_file` - Upload a local file to Drive
- `delete_file` - Permanently delete a file
- `share_file` - Share with an email address
- `make_file_public` - Make a file publicly viewable
- `create_folder` - Create a new folder
- `move_file` - Move a file to a different folder
- `list_folder` - List contents of a folder

### google-calendar
Create, read, update, and delete Google Calendar events.

**Tools:**
- `list_events` - List upcoming events
- `create_event` - Create a new event
- `update_event` - Update an existing event
- `delete_event` - Delete an event
- `list_calendars` - List all accessible calendars

### google-chat
Interact with Google Chat spaces - reactions, messages, and attachments.

**Tools:**
- `add_reaction` - Add an emoji reaction to a message
- `remove_reaction` - Remove a reaction
- `list_reactions` - List all reactions on a message
- `list_messages` - List recent messages from a space
- `get_attachments` - Get attachment metadata from a message
- `download_attachment` - Download an attachment to local file
- `send_attachment` - Upload and send a file to a space

### google-places
Search for businesses and get place details.

### image-gen
Generate and edit images using OpenRouter's Gemini models.

### finnhub
Get real-time stock quotes, company news, and profiles via Finnhub API.

**Tools:**
- `get_stock_quote` - Current price, change, high/low, open/close
- `get_company_profile` - Name, industry, market cap, website, logo
- `get_company_news` - Recent news articles for a specific stock
- `get_market_news` - General market news (general, forex, crypto, merger)
- `search_symbol` - Search for stock symbols by company name

**Setup:**
1. Get a free API key at [finnhub.io](https://finnhub.io)
2. Add `FINNHUB_API_KEY=your_key` to your `.env` file

### pdf
Convert PDF files to markdown or images.

**Tools:**
- `convert_pdf_to_markdown` - Extract text from PDF pages
- `convert_pdf_to_images` - Convert each page to PNG images

### cron
Schedule recurring and one-time tasks.

**Tools:**
- `list_jobs` - List all scheduled jobs
- `create_job` - Create a recurring job with cron/human-readable schedule
- `edit_job` - Edit an existing job
- `delete_job` - Delete a job
- `toggle_job` - Enable/disable a job
- `get_job` - Get detailed info about a job
- `schedule_once` - Schedule a one-off task

## Development

### Making Changes

After modifying any TypeScript files, you **must rebuild** for the changes to take effect:

```bash
# Rebuild everything (packages first, then servers)
npm run build

# Or rebuild a specific server
cd servers/telegram && npm run build
```

**If using HTTP mode**, also restart the service:
```bash
sudo systemctl restart mcp-servers
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
2. Add HTTP support by importing `@phouse/http-transport` (see existing servers)
3. Add port mapping to `mcp-servers.json`
4. Update `scripts/switch-to-http.sh` and `scripts/switch-to-stdio.sh`
5. Run `npm install && npm run build`
6. If using HTTP mode:
   ```bash
   sudo systemctl restart mcp-servers
   claude mcp add -s user --transport http your-server http://127.0.0.1:<port>/mcp
   ```
7. If using stdio mode:
   ```bash
   claude mcp add your-server -- node /path/to/servers/your-server/dist/mcp.js
   ```

## License

MIT
