import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runHttpServer } from "@phouse/http-transport";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { Readable } from "stream";
import * as mime from "mime-types";

// Parse command line arguments
const args = process.argv.slice(2);
const useHttp = args.includes("--http");
const portIndex = args.indexOf("--port");
const httpPort = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3011;


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
          order: {
            type: "string",
            enum: ["newest_first", "oldest_first"],
            description: "Order of messages: 'newest_first' (default) or 'oldest_first'",
          },
        },
        required: ["space_name"],
      },
    },
    {
      name: "get_attachments",
      description: "Get attachment metadata from a Google Chat message",
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
      name: "download_attachment",
      description: "Download an attachment from a Google Chat message to a local file",
      inputSchema: {
        type: "object" as const,
        properties: {
          attachment_name: {
            type: "string",
            description: "The resource name of the attachment (format: spaces/SPACE/messages/MESSAGE/attachments/ATTACHMENT)",
          },
          output_path: {
            type: "string",
            description: "Local file path to save the attachment to",
          },
          resource_name: {
            type: "string",
            description: "Optional: the attachmentDataRef.resourceName if available from list_messages or get_attachments. If not provided, will attempt to use attachment_name.",
          },
        },
        required: ["attachment_name", "output_path"],
      },
    },
    {
      name: "send_attachment",
      description: "Send a file attachment to a Google Chat space",
      inputSchema: {
        type: "object" as const,
        properties: {
          space_name: {
            type: "string",
            description: "The resource name of the space (format: spaces/SPACE)",
          },
          file_path: {
            type: "string",
            description: "Local file path to upload",
          },
          message_text: {
            type: "string",
            description: "Optional text message to include with the attachment",
          },
        },
        required: ["space_name", "file_path"],
      },
    },
    {
      name: "send_message",
      description: "Send a text message to a Google Chat space",
      inputSchema: {
        type: "object" as const,
        properties: {
          space_name: {
            type: "string",
            description: "The resource name of the space (format: spaces/SPACE)",
          },
          text: {
            type: "string",
            description: "The message text to send",
          },
        },
        required: ["space_name", "text"],
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
    const { space_name, page_size, order } = args as {
      space_name: string;
      page_size?: number;
      order?: "newest_first" | "oldest_first";
    };

    try {
      // Default to newest_first (DESC) for more intuitive behavior
      const orderBy = order === "oldest_first" ? "createTime ASC" : "createTime DESC";

      const response = await chat.spaces.messages.list({
        parent: space_name,
        pageSize: page_size || 25,
        orderBy,
      });

      const messages = (response.data.messages || []).map((msg) => ({
        name: msg.name,
        sender: msg.sender?.displayName || msg.sender?.name,
        text: msg.text,
        createTime: msg.createTime,
        attachments: msg.attachment?.map((att) => ({
          name: att.name,
          contentName: att.contentName,
          contentType: att.contentType,
          thumbnailUri: att.thumbnailUri,
          downloadUri: att.downloadUri,
          // Include attachmentDataRef if available - needed for media.download
          attachmentDataRef: att.attachmentDataRef,
        })) || [],
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            order: order || "newest_first",
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

  if (name === "get_attachments") {
    const { message_name } = args as { message_name: string };

    try {
      // Get the message to see its attachments
      const response = await chat.spaces.messages.get({
        name: message_name,
      });

      const attachments = response.data.attachment?.map((att) => ({
        name: att.name,
        contentName: att.contentName,
        contentType: att.contentType,
        thumbnailUri: att.thumbnailUri,
        downloadUri: att.downloadUri,
        source: att.source,
        // Include attachmentDataRef if available - needed for media.download
        attachmentDataRef: att.attachmentDataRef,
      })) || [];

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message_name,
            attachments,
          }, null, 2),
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to get attachments: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "download_attachment") {
    const { attachment_name, output_path, resource_name } = args as {
      attachment_name: string;
      output_path: string;
      resource_name?: string;
    };

    try {
      // Per Google docs, media.download requires attachmentDataRef.resourceName
      // If resource_name is provided (from list_messages/get_attachments), use it
      // Otherwise fall back to the attachment_name
      const downloadResourceName = resource_name || attachment_name;

      // Get access token for direct HTTP request
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
      const accessToken = tokens.access_token;

      // Use direct HTTP request - the SDK has issues with the media endpoint
      const url = `https://chat.googleapis.com/v1/media/${encodeURIComponent(downloadResourceName)}?alt=media`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // Ensure output directory exists
      const outputDir = path.dirname(output_path);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write to file
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(output_path, Buffer.from(arrayBuffer));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            attachment_name,
            resource_name_used: downloadResourceName,
            saved_to: output_path,
          }, null, 2),
        }],
      };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      return {
        content: [{ type: "text", text: `Failed to download attachment: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "send_attachment") {
    const { space_name, file_path, message_text } = args as {
      space_name: string;
      file_path: string;
      message_text?: string;
    };

    try {
      // Validate file exists
      if (!fs.existsSync(file_path)) {
        return {
          content: [{ type: "text", text: `File not found: ${file_path}` }],
          isError: true,
        };
      }

      const fileName = path.basename(file_path);
      const mimeType = mime.lookup(file_path) || 'application/octet-stream';
      const fileContent = fs.readFileSync(file_path);

      // Upload the file first
      const uploadResponse = await chat.media.upload({
        parent: space_name,
        requestBody: {
          filename: fileName,
        },
        media: {
          mimeType,
          body: Readable.from(fileContent),
        },
      });

      const attachmentDataRef = uploadResponse.data.attachmentDataRef;

      // Create message with the attachment
      const messageResponse = await chat.spaces.messages.create({
        parent: space_name,
        requestBody: {
          text: message_text || "",
          attachment: [{
            attachmentDataRef,
          }],
        },
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message_name: messageResponse.data.name,
            attachment_name: fileName,
            mime_type: mimeType,
          }, null, 2),
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send attachment: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "send_message") {
    const { space_name, text } = args as {
      space_name: string;
      text: string;
    };

    try {
      const response = await chat.spaces.messages.create({
        parent: space_name,
        requestBody: {
          text,
        },
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message_name: response.data.name,
            text: response.data.text,
            createTime: response.data.createTime,
          }, null, 2),
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send message: ${errMsg}` }],
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
  if (useHttp) {
    // HTTP mode - run as persistent server
    console.error(`[MCP] Google Chat server starting in HTTP mode on port ${httpPort}`);
    await runHttpServer(server, { port: httpPort, name: "google-chat" });
  } else {
    // Stdio mode - traditional subprocess
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCP] Google Chat server running (stdio)");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
