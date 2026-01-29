import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const CREDENTIALS_PATH = "/home/ubuntu/pHouseMcp/credentials/client_secret.json";
const TOKEN_PATH = "/home/ubuntu/pHouseMcp/credentials/tokens.json";

function getOAuth2Client() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const creds = credentials.installed || credentials.web;
  if (!creds) {
    throw new Error("Invalid credentials file: must contain 'installed' or 'web' key");
  }
  const { client_id, client_secret } = creds;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "http://localhost:8080"
  );

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oauth2Client.setCredentials(tokens);

  oauth2Client.on("tokens", (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    const updatedTokens = { ...currentTokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens, null, 2));
    fs.chmodSync(TOKEN_PATH, 0o600);
  });

  return oauth2Client;
}

const server = new Server(
  { name: "google-chat", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "add_reaction",
      description: "Add an emoji reaction to a Google Chat message",
      inputSchema: {
        type: "object" as const,
        properties: {
          message_name: {
            type: "string",
            description: "The resource name of the message (format: spaces/SPACE/messages/MESSAGE)",
          },
          emoji: {
            type: "string",
            description: "The emoji to react with (e.g., '👀', '✅', '🔄')",
          },
        },
        required: ["message_name", "emoji"],
      },
    },
    {
      name: "remove_reaction",
      description: "Remove an emoji reaction from a Google Chat message",
      inputSchema: {
        type: "object" as const,
        properties: {
          reaction_name: {
            type: "string",
            description: "The resource name of the reaction (format: spaces/SPACE/messages/MESSAGE/reactions/REACTION)",
          },
        },
        required: ["reaction_name"],
      },
    },
    {
      name: "list_reactions",
      description: "List all reactions on a Google Chat message",
      inputSchema: {
        type: "object" as const,
        properties: {
          message_name: {
            type: "string",
            description: "The resource name of the message (format: spaces/SPACE/messages/MESSAGE)",
          },
        },
        required: ["message_name"],
      },
    },
    {
      name: "list_messages",
      description: "List recent messages from a Google Chat space",
      inputSchema: {
        type: "object" as const,
        properties: {
          space_name: {
            type: "string",
            description: "The resource name of the space (format: spaces/SPACE)",
          },
          page_size: {
            type: "number",
            description: "Maximum number of messages to return (default: 25, max: 1000)",
          },
        },
        required: ["space_name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const auth = getOAuth2Client();
  const chat = google.chat({ version: "v1", auth });

  if (name === "add_reaction") {
    const { message_name, emoji } = args as { message_name: string; emoji: string };

    try {
      const response = await chat.spaces.messages.reactions.create({
        parent: message_name,
        requestBody: {
          emoji: { unicode: emoji },
        },
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            reaction_name: response.data.name,
            emoji: response.data.emoji?.unicode,
          }, null, 2),
        }],
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
    const { reaction_name } = args as { reaction_name: string };

    try {
      await chat.spaces.messages.reactions.delete({
        name: reaction_name,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, message: "Reaction removed" }, null, 2),
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to remove reaction: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "list_reactions") {
    const { message_name } = args as { message_name: string };

    try {
      const response = await chat.spaces.messages.reactions.list({
        parent: message_name,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            reactions: response.data.reactions || [],
          }, null, 2),
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to list reactions: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "list_messages") {
    const { space_name, page_size } = args as { space_name: string; page_size?: number };

    try {
      const response = await chat.spaces.messages.list({
        parent: space_name,
        pageSize: page_size || 25,
      });

      const messages = (response.data.messages || []).map((msg) => ({
        name: msg.name,
        sender: msg.sender?.displayName || msg.sender?.name,
        text: msg.text,
        createTime: msg.createTime,
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            messages,
          }, null, 2),
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to list messages: ${errMsg}` }],
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
  console.error("[MCP] Google Chat MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
