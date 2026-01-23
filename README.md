# pHouse MCP

Image generation and editing tools for Claude via the Model Context Protocol.

## Tools

- **generate_image**: Generate images using AI with text prompts
- **edit_image**: Edit existing images using AI with text prompts

Both tools use OpenRouter's Gemini image generation models (Flash and Pro variants).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` file:

   ```bash
   cp .env.example .env
   ```

3. Add your OpenRouter API key to `.env`:

   ```
   OPENROUTER_API_KEY=your_actual_key
   ```

   Get an API key from https://openrouter.ai/keys

4. Build the project:
   ```bash
   npm run build
   ```

## Add to Claude

From the root of this project, run:

```bash
claude mcp add --transport stdio --scope user phousemcp -- node $(pwd)/dist/src/mcp-server.js
```

Then restart Claude.

## CLI Usage (Optional)

```bash
# Generate an image
npm run genimage -- "a cat on a skateboard" output.png

# Edit an image
npm run editimage -- "make it sunset" input.png output.png

# Options
npm run genimage -- "prompt" output.png -a 16:9 -s 2K --pro
```

Options:

- `-a, --aspect-ratio`: 1:1, 16:9, 4:3, etc.
- `-s, --size`: 1K, 2K, 4K
- `--pro`: Use Pro model for higher quality
