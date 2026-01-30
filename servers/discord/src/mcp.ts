import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, GatewayIntentBits, TextChannel, DMChannel, NewsChannel, AttachmentBuilder } from "discord.js";
import { getRecentMessages, saveMessage } from "./history.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const botToken = process.env.DISCORD_BOT_TOKEN;
if (!botToken) {
  throw new Error("DISCORD_BOT_TOKEN environment variable is required");
}

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Connect to Discord
let isReady = false;
client.once("ready", () => {
  isReady = true;
  console.error(`[MCP] Discord bot logged in as ${client.user?.tag}`);
});

client.login(botToken).catch((err) => {
  console.error("[MCP] Failed to login to Discord:", err);
});

const server = new Server(
  { name: "discord", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_history",
      description: "Get the last N messages from a Discord channel",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "The Discord channel ID",
          },
          n: {
            type: "number",
            description: "Number of recent messages to retrieve (default: 10)",
          },
        },
        required: ["channel_id"],
      },
    },
    {
      name: "send_typing",
      description: "Show typing indicator in a Discord channel. Call this before doing work that takes time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "The Discord channel ID",
          },
        },
        required: ["channel_id"],
      },
    },
    {
      name: "send_message",
      description: "Send a message to a Discord channel",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "The Discord channel ID",
          },
          text: {
            type: "string",
            description: "The message text to send",
          },
        },
        required: ["channel_id", "text"],
      },
    },
    {
      name: "send_file",
      description: "Send a file/document to a Discord channel",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "The Discord channel ID",
          },
          file_path: {
            type: "string",
            description: "The absolute path to the file to send",
          },
          caption: {
            type: "string",
            description: "Optional message to send with the file",
          },
        },
        required: ["channel_id", "file_path"],
      },
    },
    {
      name: "add_reaction",
      description: "Add an emoji reaction to a Discord message",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "The Discord channel ID",
          },
          message_id: {
            type: "string",
            description: "The Discord message ID",
          },
          emoji: {
            type: "string",
            description: "The emoji to react with (e.g., '👀', '✅', '🔄')",
          },
        },
        required: ["channel_id", "message_id", "emoji"],
      },
    },
    {
      name: "remove_reaction",
      description: "Remove an emoji reaction from a Discord message",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "The Discord channel ID",
          },
          message_id: {
            type: "string",
            description: "The Discord message ID",
          },
          emoji: {
            type: "string",
            description: "The emoji to remove",
          },
        },
        required: ["channel_id", "message_id", "emoji"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Ensure client is ready
  if (!isReady) {
    return {
      content: [{ type: "text", text: "Discord client not ready yet. Please try again." }],
      isError: true,
    };
  }

  if (name === "get_history") {
    const { channel_id, n = 10 } = args as { channel_id: string; n?: number };

    const messages = getRecentMessages(channel_id, n);

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
    const { channel_id } = args as { channel_id: string };

    try {
      const channel = await client.channels.fetch(channel_id);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel)) {
        await channel.sendTyping();
        return { content: [] };
      }
      return {
        content: [{ type: "text", text: "Channel not found or not a text channel" }],
        isError: true,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send typing: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "send_message") {
    const { channel_id, text } = args as { channel_id: string; text: string };

    try {
      const channel = await client.channels.fetch(channel_id);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel)) {
        await channel.send(text);
        saveMessage(channel_id, {
          role: "assistant",
          text: text,
          timestamp: new Date().toISOString(),
        });
        return { content: [] };
      }
      return {
        content: [{ type: "text", text: "Channel not found or not a text channel" }],
        isError: true,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send message: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "send_file") {
    const { channel_id, file_path, caption } = args as {
      channel_id: string;
      file_path: string;
      caption?: string;
    };

    try {
      const channel = await client.channels.fetch(channel_id);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel)) {
        const filename = path.basename(file_path);
        const attachment = new AttachmentBuilder(file_path, { name: filename });
        await channel.send({
          content: caption || undefined,
          files: [attachment],
        });
        return {
          content: [{ type: "text", text: `File sent: ${filename}` }],
        };
      }
      return {
        content: [{ type: "text", text: "Channel not found or not a text channel" }],
        isError: true,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send file: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "add_reaction") {
    const { channel_id, message_id, emoji } = args as {
      channel_id: string;
      message_id: string;
      emoji: string;
    };

    try {
      const channel = await client.channels.fetch(channel_id);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel)) {
        const message = await channel.messages.fetch(message_id);
        await message.react(emoji);
        return {
          content: [{ type: "text", text: `Reaction added: ${emoji}` }],
        };
      }
      return {
        content: [{ type: "text", text: "Channel not found or not a text channel" }],
        isError: true,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to add reaction: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "remove_reaction") {
    const { channel_id, message_id, emoji } = args as {
      channel_id: string;
      message_id: string;
      emoji: string;
    };

    try {
      const channel = await client.channels.fetch(channel_id);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel)) {
        const message = await channel.messages.fetch(message_id);
        // Remove the bot's own reaction
        const reaction = message.reactions.cache.find(r => r.emoji.name === emoji || r.emoji.toString() === emoji);
        if (reaction && client.user) {
          await reaction.users.remove(client.user.id);
          return {
            content: [{ type: "text", text: `Reaction removed: ${emoji}` }],
          };
        }
        return {
          content: [{ type: "text", text: "Reaction not found" }],
        };
      }
      return {
        content: [{ type: "text", text: "Channel not found or not a text channel" }],
        isError: true,
      };
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
  console.error("[MCP] Discord MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
