import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root - configurable via PHOUSE_PROJECT_ROOT env var
// Falls back to pHouseClawd relative to pHouseMcp location (assumes sibling directories)
const PHOUSE_CLAWD_ROOT = process.env.PHOUSE_PROJECT_ROOT ||
  path.resolve(__dirname, "../../../../pHouseClawd");

// Memory directories
const LONG_TERM_DIR = path.join(PHOUSE_CLAWD_ROOT, "memory/long-term");
const SHORT_TERM_DIR = path.join(PHOUSE_CLAWD_ROOT, "memory/short-term");
const SHORT_TERM_FILE = path.join(SHORT_TERM_DIR, "buffer.txt");

// Log the resolved path on startup for debugging
console.error(`[MCP] Memory root: ${PHOUSE_CLAWD_ROOT}`);

// Size threshold for roll-up recommendation (10KB default)
const SIZE_THRESHOLD = 10 * 1024;

// Ensure directories exist
if (!fs.existsSync(LONG_TERM_DIR)) {
  fs.mkdirSync(LONG_TERM_DIR, { recursive: true });
}
if (!fs.existsSync(SHORT_TERM_DIR)) {
  fs.mkdirSync(SHORT_TERM_DIR, { recursive: true });
}

// Long-term memory file operations
function listLongTermFiles(): string[] {
  if (!fs.existsSync(LONG_TERM_DIR)) return [];
  return fs.readdirSync(LONG_TERM_DIR).filter(f => !f.startsWith("."));
}

function readLongTermFile(filename: string): string {
  const filePath = path.join(LONG_TERM_DIR, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  return "";
}

function writeLongTermFile(filename: string, content: string): void {
  const filePath = path.join(LONG_TERM_DIR, filename);
  fs.writeFileSync(filePath, content);
}

function appendLongTermFile(filename: string, content: string): void {
  const filePath = path.join(LONG_TERM_DIR, filename);
  let existing = "";
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, "utf-8");
  }
  const separator = existing.endsWith("\n") || !existing ? "" : "\n";
  fs.writeFileSync(filePath, existing + separator + content);
}

function deleteLongTermFile(filename: string): boolean {
  const filePath = path.join(LONG_TERM_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

// Short-term memory operations
function readShortTermMemory(): string {
  if (fs.existsSync(SHORT_TERM_FILE)) {
    return fs.readFileSync(SHORT_TERM_FILE, "utf-8");
  }
  return "";
}

function getShortTermSize(): number {
  if (fs.existsSync(SHORT_TERM_FILE)) {
    return fs.statSync(SHORT_TERM_FILE).size;
  }
  return 0;
}

function clearShortTermMemory(): void {
  if (fs.existsSync(SHORT_TERM_FILE)) {
    fs.writeFileSync(SHORT_TERM_FILE, "");
  }
}

function truncateShortTermMemory(): { linesBefore: number; linesAfter: number } {
  if (!fs.existsSync(SHORT_TERM_FILE)) {
    return { linesBefore: 0, linesAfter: 0 };
  }

  const content = fs.readFileSync(SHORT_TERM_FILE, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());
  const linesBefore = lines.length;

  if (linesBefore <= 1) {
    return { linesBefore, linesAfter: linesBefore };
  }

  // Keep the newer half (second half of the file)
  const halfIndex = Math.floor(linesBefore / 2);
  const keptLines = lines.slice(halfIndex);

  fs.writeFileSync(SHORT_TERM_FILE, keptLines.join("\n") + "\n");

  return { linesBefore, linesAfter: keptLines.length };
}

// Search across all long-term memory files
function searchMemory(query: string): Array<{ file: string; matches: string[] }> {
  const results: Array<{ file: string; matches: string[] }> = [];
  const queryLower = query.toLowerCase();

  // Search long-term files
  const files = listLongTermFiles();
  for (const filename of files) {
    const content = readLongTermFile(filename);
    const lines = content.split("\n");
    const matches: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 1);
        const context = lines.slice(start, end + 1).join("\n");
        matches.push(`Line ${i + 1}:\n${context}`);
      }
    }

    if (matches.length > 0) {
      results.push({ file: filename, matches });
    }
  }

  return results;
}

const server = new Server(
  { name: "memory", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // === Long-term Memory Tools ===
    {
      name: "recall",
      description:
        "Read from long-term memory. If no file specified, lists all memory files with previews. Specify a file to read its full content. Use query to search across all files.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: {
            type: "string",
            description: "Filename to read (e.g., 'journal.md', 'projects.md'). If omitted, lists all files.",
          },
          query: {
            type: "string",
            description: "Search query to find content across all files.",
          },
        },
        required: [],
      },
    },
    {
      name: "remember",
      description:
        "Save to long-term memory. Creates or updates files in the memory/long-term directory. Use mode='append' to add content, 'replace' to overwrite.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: {
            type: "string",
            description: "Filename to write to (e.g., 'journal.md', 'projects.md'). Will be created if it doesn't exist.",
          },
          content: {
            type: "string",
            description: "Content to save.",
          },
          mode: {
            type: "string",
            description: "'append' to add to end of file (default), 'replace' to overwrite entire file.",
            enum: ["append", "replace"],
          },
        },
        required: ["file", "content"],
      },
    },
    {
      name: "forget",
      description: "Delete a file from long-term memory. Use with caution!",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: {
            type: "string",
            description: "Filename to delete.",
          },
        },
        required: ["file"],
      },
    },

    // === Short-term Memory Tools ===
    {
      name: "read_short_term",
      description:
        "Read the short-term memory buffer. This contains recent conversation logs that haven't been rolled up into long-term memory yet.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "short_term_status",
      description:
        "Get the status of short-term memory (size in bytes, whether roll-up is recommended).",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "truncate_short_term",
      description:
        "Truncate the short-term memory buffer by removing the older half of entries. Use this to trim the buffer when it gets too large. Keeps the most recent entries.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },

    // === Search ===
    {
      name: "search_memory",
      description:
        "Search across all long-term memory files for a query. Returns matching lines with context.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query.",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // === Long-term Memory ===

  if (name === "recall") {
    const { file, query } = args as { file?: string; query?: string };

    // Search mode
    if (query) {
      const results = searchMemory(query);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No results found for "${query}"` }],
        };
      }
      const formatted = results
        .map((r) => `### ${r.file}\n${r.matches.join("\n\n")}`)
        .join("\n\n");
      return {
        content: [{ type: "text", text: `Search results for "${query}":\n\n${formatted}` }],
      };
    }

    // Read specific file
    if (file) {
      const content = readLongTermFile(file);
      if (!content) {
        return {
          content: [{ type: "text", text: `File not found or empty: ${file}` }],
        };
      }
      return {
        content: [{ type: "text", text: `## ${file}\n\n${content}` }],
      };
    }

    // List all files
    const files = listLongTermFiles();
    const summaries: string[] = [];

    for (const filename of files) {
      const content = readLongTermFile(filename);
      const lines = content.split("\n").filter((l) => l.trim());
      const preview = lines.slice(0, 3).join("\n");
      summaries.push(`### ${filename} (${lines.length} lines)\n${preview}${lines.length > 3 ? "\n..." : ""}`);
    }

    if (summaries.length === 0) {
      return {
        content: [{ type: "text", text: "No memory files found." }],
      };
    }

    return {
      content: [{ type: "text", text: `Long-term Memory:\n\n${summaries.join("\n\n")}` }],
    };
  }

  if (name === "remember") {
    const { file, content, mode = "append" } = args as {
      file: string;
      content: string;
      mode?: string;
    };

    if (mode === "replace") {
      writeLongTermFile(file, content);
      return {
        content: [{ type: "text", text: `Replaced content in ${file}` }],
      };
    }

    appendLongTermFile(file, content);
    return {
      content: [{ type: "text", text: `Appended to ${file}` }],
    };
  }

  if (name === "forget") {
    const { file } = args as { file: string };

    if (deleteLongTermFile(file)) {
      return {
        content: [{ type: "text", text: `Deleted ${file}` }],
      };
    }
    return {
      content: [{ type: "text", text: `File not found: ${file}` }],
      isError: true,
    };
  }

  // === Short-term Memory ===

  if (name === "read_short_term") {
    const content = readShortTermMemory();
    if (!content) {
      return {
        content: [{ type: "text", text: "Short-term memory is empty." }],
      };
    }
    return {
      content: [{ type: "text", text: `Short-term Memory:\n\n${content}` }],
    };
  }

  if (name === "short_term_status") {
    const size = getShortTermSize();
    const needsRollup = size >= SIZE_THRESHOLD;
    return {
      content: [{
        type: "text",
        text: `Short-term Memory Status:\n- Size: ${size} bytes (${(size / 1024).toFixed(2)} KB)\n- Threshold: ${SIZE_THRESHOLD} bytes (${(SIZE_THRESHOLD / 1024).toFixed(2)} KB)\n- Roll-up recommended: ${needsRollup ? "YES" : "No"}`,
      }],
    };
  }

  if (name === "truncate_short_term") {
    const { linesBefore, linesAfter } = truncateShortTermMemory();

    if (linesBefore === 0) {
      return {
        content: [{ type: "text", text: "Short-term memory is empty. Nothing to truncate." }],
      };
    }

    if (linesBefore === linesAfter) {
      return {
        content: [{ type: "text", text: `Short-term memory only has ${linesBefore} line(s). Nothing to truncate.` }],
      };
    }

    return {
      content: [{
        type: "text",
        text: `Truncated short-term memory: ${linesBefore} → ${linesAfter} lines (removed ${linesBefore - linesAfter} older entries)`,
      }],
    };
  }

  // === Search ===

  if (name === "search_memory") {
    const { query } = args as { query: string };

    const results = searchMemory(query);

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No results found for "${query}"` }],
      };
    }

    const formatted = results
      .map((r) => `### ${r.file}\n${r.matches.join("\n\n")}`)
      .join("\n\n");

    return {
      content: [{ type: "text", text: `Search results for "${query}":\n\n${formatted}` }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Memory MCP server v2.0 running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
