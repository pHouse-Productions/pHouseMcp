/**
 * Discord MCP Server - Exportable module
 * Can be imported by the gateway or run standalone via mcp.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, GatewayIntentBits, TextChannel, DMChannel, NewsChannel, AttachmentBuilder } from "discord.js";
import * as path from "path";

const DISCORD_MAX_LENGTH = 2000;

/**
 * Split a message into chunks that fit within Discord's character limit.
 * Tries to split at paragraph breaks, then line breaks, then hard limit.
 */
function splitMessage(message: string, maxLength: number = DISCORD_MAX_LENGTH): string[] {
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

export interface CreateServerOptions {
  /** Discord bot token (defaults to DISCORD_BOT_TOKEN env var) */
  botToken?: string;
}

/**
 * Create and configure the discord MCP server.
 */
export async function createServer(options: CreateServerOptions = {}): Promise<Server> {
  const botToken = options.botToken || process.env.DISCORD_BOT_TOKEN;
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

  // Connect to Discord and wait for ready
  await new Promise<void>((resolve, reject) => {
    client.once("ready", () => {
      console.error(`[MCP] Discord bot logged in as ${client.user?.tag}`);
      resolve();
    });

    client.once("error", (err) => {
      reject(err);
    });

    client.login(botToken).catch(reject);
  });

  const server = new Server(
    { name: "discord", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
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
              description: "The emoji to react with (e.g., '\ud83d\udc40', '\u2705', '\ud83d\udd04')",
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
          // Split message into chunks if it exceeds Discord's limit
          const chunks = splitMessage(text);

          for (const chunk of chunks) {
            await channel.send(chunk);
            // Small delay between chunks to maintain order
            if (chunks.length > 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

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

  return server;
}
