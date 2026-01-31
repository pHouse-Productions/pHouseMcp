import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDocsClient, getDriveClient } from "@phouse/google-auth";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const docs = getDocsClient();
const drive = getDriveClient();

// CREATE - Create a new doc from HTML
async function createDocument(title: string, html: string) {
  const response = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: "application/vnd.google-apps.document",
    },
    media: {
      mimeType: "text/html",
      body: html,
    },
  });

  const documentId = response.data.id!;
  const url = `https://docs.google.com/document/d/${documentId}/edit`;

  return { documentId, title, url };
}

// Extract base64 images from HTML, save to files, replace with file:// paths
function extractImages(html: string, documentId: string): { processedHtml: string; images: string[] } {
  const images: string[] = [];
  const imgDir = `/tmp/gdoc-${documentId}-images`;

  // Create images directory if needed
  if (!fs.existsSync(imgDir)) {
    fs.mkdirSync(imgDir, { recursive: true });
  }

  // Match base64 data URIs in img src
  const base64Regex = /src="data:image\/(png|jpeg|jpg|gif|webp);base64,([^"]+)"/g;

  let match;
  let imgIndex = 0;
  let processedHtml = html;

  // Find all matches first
  const matches: { full: string; ext: string; data: string }[] = [];
  while ((match = base64Regex.exec(html)) !== null) {
    matches.push({ full: match[0], ext: match[1], data: match[2] });
  }

  // Process each match
  for (const m of matches) {
    imgIndex++;
    const ext = m.ext === 'jpg' ? 'jpeg' : m.ext;
    const imgPath = `${imgDir}/image-${imgIndex}.${ext}`;

    // Decode and save base64 to file
    const buffer = Buffer.from(m.data, 'base64');
    fs.writeFileSync(imgPath, buffer);
    images.push(imgPath);

    // Replace in HTML with file path placeholder
    processedHtml = processedHtml.replace(m.full, `src="file://${imgPath}"`);
  }

  return { processedHtml, images };
}

// Restore file:// paths back to base64 for upload
function restoreImages(html: string): string {
  const filePathRegex = /src="file:\/\/(\/tmp\/gdoc-[^"]+)"/g;

  let match;
  const matches: { full: string; path: string }[] = [];
  while ((match = filePathRegex.exec(html)) !== null) {
    matches.push({ full: match[0], path: match[1] });
  }

  let processedHtml = html;
  for (const m of matches) {
    if (fs.existsSync(m.path)) {
      const buffer = fs.readFileSync(m.path);
      const ext = path.extname(m.path).slice(1); // remove dot
      const base64 = buffer.toString('base64');
      processedHtml = processedHtml.replace(m.full, `src="data:image/${ext};base64,${base64}"`);
    }
  }

  return processedHtml;
}

// READ - Read doc as HTML, save to file, extract images
async function readDocument(documentId: string) {
  const response = await drive.files.export({
    fileId: documentId,
    mimeType: "text/html",
  });

  const docResponse = await docs.documents.get({ documentId });
  const title = docResponse.data.title || "Untitled";
  const html = response.data as string;

  // Extract base64 images to separate files
  const { processedHtml, images } = extractImages(html, documentId);

  // Write processed HTML to temp file
  const filePath = `/tmp/gdoc-${documentId}.html`;
  fs.writeFileSync(filePath, processedHtml, "utf-8");

  return {
    title,
    documentId,
    filePath,
    imageCount: images.length,
    imagesDir: images.length > 0 ? `/tmp/gdoc-${documentId}-images` : null
  };
}

// UPDATE - Replace doc content with HTML from file
async function updateDocument(documentId: string, filePath: string) {
  const currentDoc = await drive.files.get({ fileId: documentId, fields: "name" });
  const title = currentDoc.data.name || "Untitled";

  // Read HTML from file
  let html = fs.readFileSync(filePath, "utf-8");

  // Restore file:// paths back to base64 before upload
  html = restoreImages(html);

  await drive.files.update({
    fileId: documentId,
    media: {
      mimeType: "text/html",
      body: html,
    },
  });

  return {
    documentId,
    title,
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

// SHARE - Share doc with an email
async function shareDocument(documentId: string, email: string, role: string) {
  await drive.permissions.create({
    fileId: documentId,
    requestBody: { type: "user", role, emailAddress: email },
    sendNotificationEmail: true,
  });

  return {
    documentId,
    sharedWith: email,
    role,
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

const server = new Server(
  { name: "google-docs", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_document",
      description: "Create a new Google Doc from HTML content. HTML is converted to proper Google Docs formatting (headers, bold, lists, tables, etc.). Returns the document ID and URL.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "The title of the document" },
          html: { type: "string", description: "HTML content to convert to Google Docs format. Supports: h1-h6, p, strong/b, em/i, ul/ol/li, a, table, img, br, hr, etc." },
        },
        required: ["title", "html"],
      },
    },
    {
      name: "read_document",
      description: "Read a Google Doc and return its content as HTML. Preserves formatting like headers, bold, lists, tables, etc. Useful for editing formatted documents.",
      inputSchema: {
        type: "object" as const,
        properties: {
          document_id: { type: "string", description: "The Google Doc document ID" },
        },
        required: ["document_id"],
      },
    },
    {
      name: "update_document",
      description: "Update a Google Doc by replacing its entire content with new HTML. Preserves the document ID, URL, and sharing permissions. Use read_document first to get current content.",
      inputSchema: {
        type: "object" as const,
        properties: {
          document_id: { type: "string", description: "The Google Doc document ID" },
          file_path: { type: "string", description: "Path to the HTML file to upload (use the file from read_document, or create your own)" },
        },
        required: ["document_id", "file_path"],
      },
    },
    {
      name: "share_document",
      description: "Share a Google Doc with an email address. Defaults to writer (edit) access.",
      inputSchema: {
        type: "object" as const,
        properties: {
          document_id: { type: "string", description: "The Google Doc document ID" },
          email: { type: "string", description: "Email address to share with (defaults to mikecarcasole@gmail.com)" },
          role: { type: "string", enum: ["reader", "commenter", "writer"], description: "Permission level (default: writer)" },
        },
        required: ["document_id"],
      },
    },
    {
      name: "get_document_link",
      description: "Get the shareable link for a Google Doc by its ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          document_id: { type: "string", description: "The Google Doc document ID" },
        },
        required: ["document_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "create_document") {
    const { title, html } = args as { title: string; html: string };
    try {
      const result = await createDocument(title, html);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to create document: ${error}` }], isError: true };
    }
  }

  if (name === "read_document") {
    const { document_id } = args as { document_id: string };
    try {
      const result = await readDocument(document_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to read document: ${error}` }], isError: true };
    }
  }

  if (name === "update_document") {
    const { document_id, file_path } = args as { document_id: string; file_path: string };
    try {
      const result = await updateDocument(document_id, file_path);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update document: ${error}` }], isError: true };
    }
  }

  if (name === "share_document") {
    const { document_id, email = "mikecarcasole@gmail.com", role = "writer" } = args as any;
    try {
      const result = await shareDocument(document_id, email, role);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to share document: ${error}` }], isError: true };
    }
  }

  if (name === "get_document_link") {
    const { document_id } = args as { document_id: string };
    try {
      await docs.documents.get({ documentId: document_id });
      return { content: [{ type: "text", text: `https://docs.google.com/document/d/${document_id}/edit` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to get document link: ${error}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Google Docs server running (v2.0.0 - HTML CRUD)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
