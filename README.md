# MCP Tools

A modular MCP (Model Context Protocol) server for TypeScript-based tools.

## Structure

```
mcp-tools/
├── tools/                      # Each tool in its own directory
│   └── genimage/
│       ├── genimage.ts         # Core implementation + MCP definitions
│       └── cli.ts              # CLI wrapper (optional)
├── src/
│   └── mcp-server.ts           # Main MCP server
├── dist/                       # Compiled output
├── package.json
├── tsconfig.json
└── .env                        # API keys and config
```

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
   - Get an API key from https://openrouter.ai/keys
   - Edit `.env` and set `OPENROUTER_API_KEY=your_actual_key`

4. Build the project:
   ```bash
   npm run build
   ```

## Current Tools

### genimage
Generate images using OpenRouter's Gemini image models.

**CLI Usage:**
```bash
npm run genimage -- "your prompt" output.png [options]

Options:
  -a, --aspect-ratio RATIO   Aspect ratio (1:1, 16:9, etc.)
  -s, --size SIZE           Image size (1K, 2K, 4K)
  --pro                     Use Pro model
  -v, --verbose             Show full API response

Examples:
  npm run genimage -- "a cat on a skateboard" cat.png
  npm run genimage -- "sunset" sunset.png -a 16:9 -s 2K
  npm run genimage -- "landscape" landscape.png --pro
```

**Models:**
- **Flash** (default): `google/gemini-2.5-flash-image` - Fast and cost-effective
- **Pro**: `google/gemini-3-pro-image-preview` - Higher quality

**Options:**
- **Aspect Ratios**: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- **Image Sizes**: 1K, 2K, 4K

## MCP Server Usage

Add to your MCP client config:

**Claude Code** (`~/Library/Application Support/Claude/claude_code_config.json`):
```json
{
  "mcpServers": {
    "mcp-tools": {
      "command": "node",
      "args": [
        "/Users/mcarcaso/Work/ScriptsForClaude/mcp-genimage/dist/mcp-server.js"
      ]
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "mcp-tools": {
      "command": "node",
      "args": [
        "/Users/mcarcaso/Work/ScriptsForClaude/mcp-genimage/dist/mcp-server.js"
      ]
    }
  }
}
```

Restart Claude, and all tools will be available.

## Adding a New Tool

### 1. Create tool directory
```bash
mkdir tools/newtool
```

### 2. Create implementation file `tools/newtool/newtool.ts`
```typescript
// Your implementation
export async function myFunction(options: any) {
  // ... implementation
  return { result: "success" };
}

// MCP Tool Definition
export const mcpTool = {
  name: "my_tool",
  description: "Description of what your tool does",
  inputSchema: {
    type: "object",
    properties: {
      field1: {
        type: "string",
        description: "Description of field1",
      },
      field2: {
        type: "number",
        description: "Description of field2",
      },
    },
    required: ["field1"],
  },
};

// MCP Handler
export async function mcpHandler(args: any) {
  try {
    const result = await myFunction(args);
    return {
      content: [{
        type: "text",
        text: `Success: ${JSON.stringify(result)}`,
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }],
      isError: true,
    };
  }
}
```

### 3. Register in MCP server `src/mcp-server.ts`
```typescript
// Add import
import * as newtool from "../tools/newtool/newtool.js";

// Add to tools array
const tools = [
  { definition: genimage.mcpTool, handler: genimage.mcpHandler },
  { definition: newtool.mcpTool, handler: newtool.mcpHandler }, // Add this
];
```

### 4. (Optional) Add CLI `tools/newtool/cli.ts`
```typescript
#!/usr/bin/env node
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "..", "..", ".env") });

import { myFunction } from "./newtool.js";

async function main() {
  const args = process.argv.slice(2);
  // ... parse args and call myFunction
}

main();
```

### 5. (Optional) Add npm script in `package.json`
```json
"scripts": {
  "newtool": "tsx tools/newtool/cli.ts"
}
```

### 6. Build and test
```bash
npm run build
npm run newtool -- [args]
```

## Development

```bash
# Build project
npm run build

# Run MCP server in dev mode
npm run dev

# Run specific tool CLI
npm run genimage -- "prompt" output.png
```

## Benefits of This Structure

- **Modular**: Each tool is self-contained in its own directory
- **Easy to add**: Just create a new directory in `tools/` and follow the pattern
- **CLI optional**: Tools can be MCP-only or have an optional CLI
- **Auto-discovery**: MCP server imports and registers all tools
- **Type-safe**: Full TypeScript support
- **Clean separation**: MCP definitions live with implementation
