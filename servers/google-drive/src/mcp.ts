import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDriveClient } from "@phouse/google-auth";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const drive = getDriveClient();

async function searchFiles(query: string, fileType?: string, maxResults: number = 20) {
  let q = `name contains '${query.replace(/'/g, "\\'")}'`;

  if (fileType === "spreadsheet") {
    q += " and mimeType='application/vnd.google-apps.spreadsheet'";
  } else if (fileType === "document") {
    q += " and mimeType='application/vnd.google-apps.document'";
  } else if (fileType === "pdf") {
    q += " and mimeType='application/pdf'";
  }
  // "all" or undefined = no mimeType filter, returns everything

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
  } else if (fileType === "pdf") {
    q += " and mimeType='application/pdf'";
  }
  // "all" or undefined = no mimeType filter, returns everything

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

async function createFolder(name: string, parentId?: string) {
  const fileMetadata: any = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) fileMetadata.parents = [parentId];

  const response = await drive.files.create({
    requestBody: fileMetadata,
    fields: "id, name, webViewLink",
  });

  return {
    folderId: response.data.id,
    name: response.data.name,
    webViewLink: response.data.webViewLink,
  };
}

async function moveFile(fileId: string, newParentId: string) {
  // Get the current parents
  const file = await drive.files.get({ fileId, fields: "parents" });
  const previousParents = file.data.parents?.join(",") || "";

  // Move to new parent
  const response = await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: previousParents,
    fields: "id, name, parents, webViewLink",
  });

  return {
    fileId: response.data.id,
    name: response.data.name,
    newParentId,
    webViewLink: response.data.webViewLink,
  };
}

async function listFolder(folderId: string, maxResults: number = 50) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    pageSize: maxResults,
    fields: "files(id, name, mimeType, createdTime, modifiedTime, webViewLink)",
    orderBy: "name",
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

const server = new Server(
  { name: "google-drive", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_files",
      description: "Search for files in Google Drive by name. Returns matching files with their IDs, names, and links.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query to match against file names" },
          file_type: { type: "string", enum: ["spreadsheet", "document", "pdf", "all"], description: "Filter by file type. 'all' returns all file types including PDFs, images, etc. (default: all)" },
          max_results: { type: "number", description: "Maximum number of results to return (default: 20)" },
        },
        required: ["query"],
      },
    },
    {
      name: "list_recent_files",
      description: "List recent files in Google Drive, sorted by last modified time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_type: { type: "string", enum: ["spreadsheet", "document", "pdf", "all"], description: "Filter by file type. 'all' returns all file types including PDFs, images, etc. (default: all)" },
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
    {
      name: "create_folder",
      description: "Create a new folder in Google Drive. Returns the folder ID and link.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Name of the folder to create" },
          parent_id: { type: "string", description: "Optional parent folder ID. If not specified, creates in root." },
        },
        required: ["name"],
      },
    },
    {
      name: "move_file",
      description: "Move a file or folder to a different parent folder in Google Drive.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_id: { type: "string", description: "The file or folder ID to move" },
          new_parent_id: { type: "string", description: "The destination folder ID" },
        },
        required: ["file_id", "new_parent_id"],
      },
    },
    {
      name: "list_folder",
      description: "List contents of a Google Drive folder.",
      inputSchema: {
        type: "object" as const,
        properties: {
          folder_id: { type: "string", description: "The folder ID to list contents of" },
          max_results: { type: "number", description: "Maximum number of results (default: 50)" },
        },
        required: ["folder_id"],
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

  if (name === "create_folder") {
    const { name: folderName, parent_id } = args as { name: string; parent_id?: string };
    try {
      const result = await createFolder(folderName, parent_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to create folder: ${error}` }], isError: true };
    }
  }

  if (name === "move_file") {
    const { file_id, new_parent_id } = args as { file_id: string; new_parent_id: string };
    try {
      const result = await moveFile(file_id, new_parent_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to move file: ${error}` }], isError: true };
    }
  }

  if (name === "list_folder") {
    const { folder_id, max_results = 50 } = args as { folder_id: string; max_results?: number };
    try {
      const result = await listFolder(folder_id, max_results);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to list folder: ${error}` }], isError: true };
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
