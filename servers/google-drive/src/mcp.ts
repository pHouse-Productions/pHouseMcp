import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDriveClient } from "@phouse/google-auth";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const drive = getDriveClient();

async function searchFiles(query: string, fileType?: string, maxResults: number = 20) {
  let q = `name contains '${query.replace(/'/g, "\\'")}'`;

  if (fileType === "spreadsheet") {
    q += " and mimeType='application/vnd.google-apps.spreadsheet'";
  } else if (fileType === "document") {
    q += " and mimeType='application/vnd.google-apps.document'";
  } else if (fileType === "all") {
    q += " and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document')";
  }

  q += " and trashed=false";

  const response = await drive.files.list({
    q,
    pageSize: maxResults,
    fields: "files(id, name, mimeType, createdTime, modifiedTime, webViewLink)",
    orderBy: "modifiedTime desc",
  });

  return {
    files: (response.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
    })),
    totalFound: response.data.files?.length || 0,
  };
}

async function listRecentFiles(fileType?: string, maxResults: number = 20) {
  let q = "trashed=false";

  if (fileType === "spreadsheet") {
    q += " and mimeType='application/vnd.google-apps.spreadsheet'";
  } else if (fileType === "document") {
    q += " and mimeType='application/vnd.google-apps.document'";
  } else if (fileType === "all") {
    q += " and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document')";
  }

  const response = await drive.files.list({
    q,
    pageSize: maxResults,
    fields: "files(id, name, mimeType, createdTime, modifiedTime, webViewLink)",
    orderBy: "modifiedTime desc",
  });

  return {
    files: (response.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
    })),
  };
}

async function deleteFile(fileId: string) {
  await drive.files.delete({ fileId });
  return { fileId, deleted: true };
}

async function uploadFile(filePath: string, fileName?: string, folderId?: string) {
  const actualFileName = fileName || path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
  };
  const mimeType = mimeTypes[ext] || "application/octet-stream";

  const fileMetadata: any = { name: actualFileName };
  if (folderId) fileMetadata.parents = [folderId];

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: "id, name, mimeType, webViewLink, webContentLink",
  });

  return {
    fileId: response.data.id,
    name: response.data.name,
    mimeType: response.data.mimeType,
    webViewLink: response.data.webViewLink,
    webContentLink: response.data.webContentLink,
  };
}

async function shareFile(fileId: string, email: string, role: string = "reader") {
  await drive.permissions.create({
    fileId,
    requestBody: { type: "user", role, emailAddress: email },
    sendNotificationEmail: false,
  });

  return { fileId, sharedWith: email, role };
}

async function makeFilePublic(fileId: string) {
  await drive.permissions.create({
    fileId,
    requestBody: { type: "anyone", role: "reader" },
  });

  const file = await drive.files.get({ fileId, fields: "webViewLink" });
  return { fileId, webViewLink: file.data.webViewLink };
}

const server = new Server(
  { name: "google-drive", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_files",
      description: "Search for Google Docs and Sheets by name. Returns matching files with their IDs, names, and links.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query to match against file names" },
          file_type: { type: "string", enum: ["spreadsheet", "document", "all"], description: "Filter by file type (default: all)" },
          max_results: { type: "number", description: "Maximum number of results to return (default: 20)" },
        },
        required: ["query"],
      },
    },
    {
      name: "list_recent_files",
      description: "List recent Google Docs and Sheets, sorted by last modified time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_type: { type: "string", enum: ["spreadsheet", "document", "all"], description: "Filter by file type (default: all)" },
          max_results: { type: "number", description: "Maximum number of results to return (default: 20)" },
        },
        required: [],
      },
    },
    {
      name: "delete_file",
      description: "Permanently delete a Google Doc or Sheet by its file ID. Use with caution!",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_id: { type: "string", description: "The Google Drive file ID to delete" },
        },
        required: ["file_id"],
      },
    },
    {
      name: "upload_file",
      description: "Upload a file (PDF, image, etc.) to Google Drive. Returns the file ID and shareable link.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_path: { type: "string", description: "The local file path to upload" },
          file_name: { type: "string", description: "Optional name for the file in Drive" },
          folder_id: { type: "string", description: "Optional Google Drive folder ID to upload to" },
        },
        required: ["file_path"],
      },
    },
    {
      name: "share_file",
      description: "Share a Google Drive file with a specific email address.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_id: { type: "string", description: "The Google Drive file ID to share" },
          email: { type: "string", description: "Email address to share with (defaults to mikecarcasole@gmail.com)" },
          role: { type: "string", enum: ["reader", "commenter", "writer"], description: "Permission level (default: reader)" },
        },
        required: ["file_id"],
      },
    },
    {
      name: "make_file_public",
      description: "Make a Google Drive file publicly viewable via link.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_id: { type: "string", description: "The Google Drive file ID to make public" },
        },
        required: ["file_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_files") {
    const { query, file_type, max_results = 20 } = args as any;
    try {
      const result = await searchFiles(query, file_type || "all", max_results);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to search files: ${error}` }], isError: true };
    }
  }

  if (name === "list_recent_files") {
    const { file_type, max_results = 20 } = (args as any) || {};
    try {
      const result = await listRecentFiles(file_type || "all", max_results);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to list recent files: ${error}` }], isError: true };
    }
  }

  if (name === "delete_file") {
    const { file_id } = args as { file_id: string };
    try {
      const result = await deleteFile(file_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to delete file: ${error}` }], isError: true };
    }
  }

  if (name === "upload_file") {
    const { file_path, file_name, folder_id } = args as any;
    try {
      const result = await uploadFile(file_path, file_name, folder_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to upload file: ${error}` }], isError: true };
    }
  }

  if (name === "share_file") {
    const { file_id, email = "mikecarcasole@gmail.com", role = "reader" } = args as any;
    try {
      const result = await shareFile(file_id, email, role);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to share file: ${error}` }], isError: true };
    }
  }

  if (name === "make_file_public") {
    const { file_id } = args as { file_id: string };
    try {
      const result = await makeFilePublic(file_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to make file public: ${error}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Google Drive server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
