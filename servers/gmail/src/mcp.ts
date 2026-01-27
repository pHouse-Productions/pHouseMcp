import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getGmailClient } from "@phouse/google-auth";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const gmail = getGmailClient();

interface EmailSummary {
  id: string;
  threadId: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

interface EmailFull {
  id: string;
  threadId: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  html?: string;
}

function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBody(payload: any): { text: string; html?: string } {
  let text = "";
  let html: string | undefined;

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") {
      html = decoded;
    } else {
      text = decoded;
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        html = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        const nested = extractBody(part);
        if (nested.text) text = nested.text;
        if (nested.html) html = nested.html;
      }
    }
  }

  return { text, html };
}

async function fetchEmails(folder: string, count: number, unseenOnly: boolean): Promise<EmailSummary[]> {
  let query = "";
  if (folder.toUpperCase() !== "INBOX") {
    query = `in:${folder}`;
  }
  if (unseenOnly) {
    query = query ? `${query} is:unread` : "is:unread";
  }

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults: count,
    q: query || undefined,
  });

  const messages = response.data.messages || [];
  const emails: EmailSummary[] = [];

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date", "Message-ID"],
    });

    const headers = detail.data.payload?.headers || [];

    emails.push({
      id: msg.id!,
      threadId: msg.threadId!,
      messageId: getHeader(headers, "Message-ID"),
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      date: getHeader(headers, "Date"),
      snippet: detail.data.snippet || "",
    });
  }

  return emails;
}

async function fetchEmailById(id: string): Promise<EmailFull> {
  const detail = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });

  const headers = detail.data.payload?.headers || [];
  const { text, html } = extractBody(detail.data.payload);

  return {
    id: detail.data.id!,
    threadId: detail.data.threadId!,
    messageId: getHeader(headers, "Message-ID"),
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    body: text,
    html,
  };
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".txt": "text/plain",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string,
  cc?: string,
  bcc?: string,
  attachments?: string[],
  threadId?: string,
  inReplyTo?: string
): Promise<string> {
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];

  if (inReplyTo) {
    messageParts.push(`In-Reply-To: ${inReplyTo}`);
    messageParts.push(`References: ${inReplyTo}`);
  }

  if (cc) messageParts.splice(1, 0, `Cc: ${cc}`);
  if (bcc) messageParts.splice(cc ? 2 : 1, 0, `Bcc: ${bcc}`);

  const hasAttachments = attachments && attachments.length > 0;

  if (hasAttachments) {
    const mixedBoundary = "mixed_boundary_" + Date.now();
    messageParts.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    messageParts.push("");
    messageParts.push(`--${mixedBoundary}`);
    messageParts.push("Content-Type: text/plain; charset=utf-8");
    messageParts.push("");
    messageParts.push(body);

    for (const filePath of attachments) {
      const fileName = path.basename(filePath);
      const mimeType = getMimeType(filePath);
      const fileContent = fs.readFileSync(filePath);
      const base64Content = fileContent.toString("base64");

      messageParts.push(`--${mixedBoundary}`);
      messageParts.push(`Content-Type: ${mimeType}; name="${fileName}"`);
      messageParts.push("Content-Transfer-Encoding: base64");
      messageParts.push(`Content-Disposition: attachment; filename="${fileName}"`);
      messageParts.push("");
      messageParts.push(base64Content);
    }

    messageParts.push(`--${mixedBoundary}--`);
  } else {
    messageParts.push("Content-Type: text/plain; charset=utf-8");
    messageParts.push("");
    messageParts.push(body);
  }

  const message = messageParts.join("\r\n");
  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const requestBody: { raw: string; threadId?: string } = { raw: encodedMessage };
  if (threadId) requestBody.threadId = threadId;

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody,
  });

  return response.data.id || "sent";
}

const server = new Server(
  { name: "gmail", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "fetch_emails",
      description: "Fetch recent emails from Gmail inbox. Returns a list of email summaries.",
      inputSchema: {
        type: "object" as const,
        properties: {
          folder: { type: "string", description: 'The mailbox folder to fetch from (default: "INBOX")' },
          count: { type: "number", description: "Number of recent emails to fetch (default: 10)" },
          unseen_only: { type: "boolean", description: "Only fetch unread emails (default: false)" },
        },
        required: [],
      },
    },
    {
      name: "read_email",
      description: "Read the full content of a specific email by its ID. Use fetch_emails first to get IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "The ID of the email to read" },
        },
        required: ["id"],
      },
    },
    {
      name: "send_email",
      description: "Send an email from the Gmail account.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Plain text email body" },
          html: { type: "string", description: "Optional HTML email body" },
          cc: { type: "string", description: "CC recipient(s) - comma-separated for multiple" },
          bcc: { type: "string", description: "BCC recipient(s) - comma-separated for multiple" },
          attachments: { type: "array", items: { type: "string" }, description: "Optional array of file paths to attach to the email" },
          thread_id: { type: "string", description: "Thread ID to reply within (keeps reply in same conversation)" },
          in_reply_to: { type: "string", description: "Message-ID header of the email being replied to" },
        },
        required: ["to", "subject", "body"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "fetch_emails") {
    const { folder = "INBOX", count = 10, unseen_only = false } = (args as any) || {};
    try {
      const emails = await fetchEmails(folder, count, unseen_only);
      return { content: [{ type: "text", text: JSON.stringify(emails, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to fetch emails: ${error}` }], isError: true };
    }
  }

  if (name === "read_email") {
    const { id } = args as { id: string };
    try {
      const email = await fetchEmailById(id);
      return { content: [{ type: "text", text: JSON.stringify(email, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to read email: ${error}` }], isError: true };
    }
  }

  if (name === "send_email") {
    const { to, subject, body, html, cc, bcc, attachments, thread_id, in_reply_to } = args as any;
    try {
      const messageId = await sendEmail(to, subject, body, html, cc, bcc, attachments, thread_id, in_reply_to);
      return { content: [{ type: "text", text: `Email sent successfully. Message ID: ${messageId}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to send email: ${error}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Gmail server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
