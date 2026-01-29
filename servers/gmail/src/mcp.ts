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

// Filter types
interface FilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: "larger" | "smaller";
}

interface FilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
  archive?: boolean;
  markRead?: boolean;
  star?: boolean;
  trash?: boolean;
  neverSpam?: boolean;
  important?: boolean;
}

interface GmailFilter {
  id: string;
  criteria: FilterCriteria;
  action: FilterAction;
}

async function listFilters(): Promise<GmailFilter[]> {
  const response = await gmail.users.settings.filters.list({ userId: "me" });
  const filters = response.data.filter || [];

  return filters.map((f) => ({
    id: f.id!,
    criteria: {
      from: f.criteria?.from || undefined,
      to: f.criteria?.to || undefined,
      subject: f.criteria?.subject || undefined,
      query: f.criteria?.query || undefined,
      negatedQuery: f.criteria?.negatedQuery || undefined,
      hasAttachment: f.criteria?.hasAttachment || undefined,
      excludeChats: f.criteria?.excludeChats || undefined,
      size: f.criteria?.size || undefined,
      sizeComparison: f.criteria?.sizeComparison as "larger" | "smaller" | undefined,
    },
    action: {
      addLabelIds: f.action?.addLabelIds || undefined,
      removeLabelIds: f.action?.removeLabelIds || undefined,
      forward: f.action?.forward || undefined,
      archive: f.action?.removeLabelIds?.includes("INBOX") || undefined,
      markRead: f.action?.removeLabelIds?.includes("UNREAD") || undefined,
      star: f.action?.addLabelIds?.includes("STARRED") || undefined,
      trash: f.action?.addLabelIds?.includes("TRASH") || undefined,
    },
  }));
}

async function createFilter(criteria: FilterCriteria, action: FilterAction): Promise<GmailFilter> {
  // Build the Gmail API filter format
  const filterCriteria: any = {};
  if (criteria.from) filterCriteria.from = criteria.from;
  if (criteria.to) filterCriteria.to = criteria.to;
  if (criteria.subject) filterCriteria.subject = criteria.subject;
  if (criteria.query) filterCriteria.query = criteria.query;
  if (criteria.negatedQuery) filterCriteria.negatedQuery = criteria.negatedQuery;
  if (criteria.hasAttachment !== undefined) filterCriteria.hasAttachment = criteria.hasAttachment;
  if (criteria.excludeChats !== undefined) filterCriteria.excludeChats = criteria.excludeChats;
  if (criteria.size !== undefined) filterCriteria.size = criteria.size;
  if (criteria.sizeComparison) filterCriteria.sizeComparison = criteria.sizeComparison;

  const filterAction: any = {};
  const addLabelIds: string[] = [];
  const removeLabelIds: string[] = [];

  if (action.forward) filterAction.forward = action.forward;
  if (action.archive) removeLabelIds.push("INBOX");
  if (action.markRead) removeLabelIds.push("UNREAD");
  if (action.star) addLabelIds.push("STARRED");
  if (action.trash) addLabelIds.push("TRASH");
  if (action.neverSpam) removeLabelIds.push("SPAM");
  if (action.important) addLabelIds.push("IMPORTANT");
  if (action.addLabelIds) addLabelIds.push(...action.addLabelIds);
  if (action.removeLabelIds) removeLabelIds.push(...action.removeLabelIds);

  if (addLabelIds.length > 0) filterAction.addLabelIds = addLabelIds;
  if (removeLabelIds.length > 0) filterAction.removeLabelIds = removeLabelIds;

  const response = await gmail.users.settings.filters.create({
    userId: "me",
    requestBody: {
      criteria: filterCriteria,
      action: filterAction,
    },
  });

  return {
    id: response.data.id!,
    criteria,
    action,
  };
}

async function deleteFilter(filterId: string): Promise<void> {
  await gmail.users.settings.filters.delete({
    userId: "me",
    id: filterId,
  });
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
    {
      name: "list_filters",
      description: "List all Gmail filters configured on the account.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "create_filter",
      description: "Create a Gmail filter with criteria and actions. Use negatedQuery for 'NOT from:' style exclusions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          from: { type: "string", description: "Match emails from this address/pattern" },
          to: { type: "string", description: "Match emails to this address/pattern" },
          subject: { type: "string", description: "Match emails with this subject" },
          query: { type: "string", description: "Gmail search query to match (e.g., 'has:attachment')" },
          negated_query: { type: "string", description: "Gmail search query to exclude (e.g., 'from:trusted@email.com')" },
          has_attachment: { type: "boolean", description: "Match emails with attachments" },
          forward: { type: "string", description: "Forward matching emails to this address" },
          archive: { type: "boolean", description: "Archive matching emails (remove from inbox)" },
          mark_read: { type: "boolean", description: "Mark matching emails as read" },
          star: { type: "boolean", description: "Star matching emails" },
          trash: { type: "boolean", description: "Move matching emails to trash" },
          never_spam: { type: "boolean", description: "Never mark matching emails as spam" },
          important: { type: "boolean", description: "Mark matching emails as important" },
        },
        required: [],
      },
    },
    {
      name: "delete_filter",
      description: "Delete a Gmail filter by its ID. Use list_filters to get filter IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          filter_id: { type: "string", description: "The ID of the filter to delete" },
        },
        required: ["filter_id"],
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

  if (name === "list_filters") {
    try {
      const filters = await listFilters();
      return { content: [{ type: "text", text: JSON.stringify(filters, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to list filters: ${error}` }], isError: true };
    }
  }

  if (name === "create_filter") {
    const {
      from, to, subject, query, negated_query, has_attachment,
      forward, archive, mark_read, star, trash, never_spam, important,
    } = args as any;

    const criteria: FilterCriteria = {};
    if (from) criteria.from = from;
    if (to) criteria.to = to;
    if (subject) criteria.subject = subject;
    if (query) criteria.query = query;
    if (negated_query) criteria.negatedQuery = negated_query;
    if (has_attachment !== undefined) criteria.hasAttachment = has_attachment;

    const action: FilterAction = {};
    if (forward) action.forward = forward;
    if (archive) action.archive = archive;
    if (mark_read) action.markRead = mark_read;
    if (star) action.star = star;
    if (trash) action.trash = trash;
    if (never_spam) action.neverSpam = never_spam;
    if (important) action.important = important;

    try {
      const filter = await createFilter(criteria, action);
      return { content: [{ type: "text", text: `Filter created successfully:\n${JSON.stringify(filter, null, 2)}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to create filter: ${error}` }], isError: true };
    }
  }

  if (name === "delete_filter") {
    const { filter_id } = args as { filter_id: string };
    try {
      await deleteFilter(filter_id);
      return { content: [{ type: "text", text: `Filter ${filter_id} deleted successfully.` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to delete filter: ${error}` }], isError: true };
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
