import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Telegraf } from "telegraf";
import { getRecentMessages, saveMessage } from "./history.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

const bot = new Telegraf(botToken);

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Split a message into chunks that fit within Telegram's character limit.
 * Tries to split at paragraph breaks, then line breaks, then hard limit.
 */
function splitMessage(message: string, maxLength: number = TELEGRAM_MAX_LENGTH): string[] {
  const chunks: string[] = [];

  if (message.length <= maxLength) {
    chunks.push(message);
  } else {
    let remaining = message;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a paragraph break
      let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // No good paragraph break, try single newline
        splitIndex = remaining.lastIndexOf("\n", maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // No good newline, just split at max length
        splitIndex = maxLength;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trimStart();
    }
  }

  return chunks;
}

const server = new Server(
  { name: "telegram", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_history",
      description: "Get the last N messages from a Telegram conversation",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "number",
            description: "The Telegram chat ID",
          },
          n: {
            type: "number",
            description: "Number of recent messages to retrieve (default: 10)",
          },
        },
        required: ["chat_id"],
      },
    },
    {
      name: "send_typing",
      description: "Show typing indicator in a Telegram chat. Call this before doing work that takes time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "number",
            description: "The Telegram chat ID",
          },
        },
        required: ["chat_id"],
      },
    },
    {
      name: "send_message",
      description: "Send a message to a Telegram chat",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "number",
            description: "The Telegram chat ID",
          },
          text: {
            type: "string",
            description: "The message text to send",
          },
        },
        required: ["chat_id", "text"],
      },
    },
    {
      name: "send_document",
      description: "Send a file/document to a Telegram chat",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "number",
            description: "The Telegram chat ID",
          },
          file_path: {
            type: "string",
            description: "The absolute path to the file to send",
          },
          caption: {
            type: "string",
            description: "Optional caption for the document",
          },
        },
        required: ["chat_id", "file_path"],
      },
    },
    {
      name: "send_photo",
      description: "Send a photo/image to a Telegram chat (renders inline, not as file attachment)",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "number",
            description: "The Telegram chat ID",
          },
          file_path: {
            type: "string",
            description: "The absolute path to the image file to send",
          },
          caption: {
            type: "string",
            description: "Optional caption for the photo",
          },
        },
        required: ["chat_id", "file_path"],
      },
    },
    {
      name: "add_reaction",
      description: "Add an emoji reaction to a Telegram message",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "number",
            description: "The Telegram chat ID",
          },
          message_id: {
            type: "number",
            description: "The message ID to react to",
          },
          emoji: {
            type: "string",
            description: "The emoji to react with (e.g., '👀', '✅', '🔄')",
          },
        },
        required: ["chat_id", "message_id", "emoji"],
      },
    },
    {
      name: "remove_reaction",
      description: "Remove an emoji reaction from a Telegram message (removes all bot reactions)",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "number",
            description: "The Telegram chat ID",
          },
          message_id: {
            type: "number",
            description: "The message ID to remove reaction from",
          },
        },
        required: ["chat_id", "message_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_history") {
    const { chat_id, n = 10 } = args as { chat_id: number; n?: number };

    const messages = getRecentMessages(chat_id, n);

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: "No conversation history found" }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
    };
  }

  if (name === "send_typing") {
    const { chat_id } = args as { chat_id: number };

    try {
      await bot.telegram.sendChatAction(chat_id, "typing");
      return { content: [] };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send typing: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "send_message") {
    const { chat_id, text } = args as { chat_id: number; text: string };

    try {
      // Split message into chunks if it exceeds Telegram's limit
      const chunks = splitMessage(text);

      for (const chunk of chunks) {
        await bot.telegram.sendMessage(chat_id, chunk);
        // Small delay between chunks to maintain order
        if (chunks.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      saveMessage(chat_id, {
        role: "assistant",
        text: text,
        timestamp: new Date().toISOString(),
      });
      return { content: [] };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send message: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "send_document") {
    const { chat_id, file_path, caption } = args as {
      chat_id: number;
      file_path: string;
      caption?: string;
    };

    try {
      const fileStream = fs.createReadStream(file_path);
      const filename = path.basename(file_path);
      await bot.telegram.sendDocument(
        chat_id,
        { source: fileStream, filename },
        caption ? { caption } : undefined
      );
      return {
        content: [{ type: "text", text: `Document sent: ${filename}` }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send document: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "send_photo") {
    const { chat_id, file_path, caption } = args as {
      chat_id: number;
      file_path: string;
      caption?: string;
    };

    try {
      const fileStream = fs.createReadStream(file_path);
      await bot.telegram.sendPhoto(
        chat_id,
        { source: fileStream },
        caption ? { caption } : undefined
      );
      const filename = path.basename(file_path);
      return {
        content: [{ type: "text", text: `Photo sent: ${filename}` }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send photo: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "add_reaction") {
    const { chat_id, message_id, emoji } = args as {
      chat_id: number;
      message_id: number;
      emoji: string;
    };

    try {
      await bot.telegram.setMessageReaction(chat_id, message_id, [
        { type: "emoji", emoji } as any,
      ]);
      return { content: [] };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to add reaction: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "remove_reaction") {
    const { chat_id, message_id } = args as {
      chat_id: number;
      message_id: number;
    };

    try {
      // Pass empty array to remove all reactions
      await bot.telegram.setMessageReaction(chat_id, message_id, []);
      return { content: [] };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to remove reaction: ${errMsg}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Telegram MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
