import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDocsClient, getDriveClient } from "@phouse/google-auth";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const docs = getDocsClient();
const drive = getDriveClient();

async function createDocument(title: string, content?: string) {
  const createResponse = await docs.documents.create({
    requestBody: { title },
  });

  const documentId = createResponse.data.documentId!;
  const url = `https://docs.google.com/document/d/${documentId}/edit`;

  if (content) {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: content } }],
      },
    });
  }

  return { documentId, title, url };
}

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

async function readDocument(documentId: string) {
  const response = await docs.documents.get({ documentId });
  const title = response.data.title || "Untitled";

  let content = "";
  const body = response.data.body;

  if (body?.content) {
    for (const element of body.content) {
      if (element.paragraph?.elements) {
        for (const elem of element.paragraph.elements) {
          if (elem.textRun?.content) {
            content += elem.textRun.content;
          }
        }
      }
    }
  }

  return { title, content };
}

async function appendToDocument(documentId: string, text: string) {
  const doc = await docs.documents.get({ documentId });
  const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{ insertText: { location: { index: endIndex - 1 }, text } }],
    },
  });
}

const server = new Server(
  { name: "google-docs", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_document",
      description: "Create a new Google Doc with an optional title and content. Returns the document ID and URL.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "The title of the document (default: 'Untitled')" },
          content: { type: "string", description: "Optional initial content to add to the document" },
        },
        required: [],
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
    {
      name: "read_document",
      description: "Read the title and text content of a Google Doc.",
      inputSchema: {
        type: "object" as const,
        properties: {
          document_id: { type: "string", description: "The Google Doc document ID" },
        },
        required: ["document_id"],
      },
    },
    {
      name: "append_to_document",
      description: "Append text to the end of an existing Google Doc.",
      inputSchema: {
        type: "object" as const,
        properties: {
          document_id: { type: "string", description: "The Google Doc document ID" },
          text: { type: "string", description: "Text to append to the document" },
        },
        required: ["document_id", "text"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "create_document") {
    const { title = "Untitled", content } = (args as any) || {};
    try {
      const result = await createDocument(title, content);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to create document: ${error}` }], isError: true };
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

  if (name === "read_document") {
    const { document_id } = args as { document_id: string };
    try {
      const result = await readDocument(document_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to read document: ${error}` }], isError: true };
    }
  }

  if (name === "append_to_document") {
    const { document_id, text } = args as { document_id: string; text: string };
    try {
      await appendToDocument(document_id, text);
      return { content: [{ type: "text", text: `Successfully appended text to document ${document_id}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to append to document: ${error}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Google Docs server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
