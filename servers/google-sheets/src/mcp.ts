import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getSheetsClient, getDriveClient } from "@phouse/google-auth";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const sheets = getSheetsClient();
const drive = getDriveClient();

async function createSpreadsheet(title: string, sheetNames?: string[]) {
  const requestBody: any = { properties: { title } };

  if (sheetNames && sheetNames.length > 0) {
    requestBody.sheets = sheetNames.map((name) => ({ properties: { title: name } }));
  }

  const response = await sheets.spreadsheets.create({ requestBody });
  const spreadsheetId = response.data.spreadsheetId!;

  return {
    spreadsheetId,
    title,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

async function shareSpreadsheet(spreadsheetId: string, email: string, role: string) {
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: "user", role, emailAddress: email },
    sendNotificationEmail: true,
  });

  return {
    spreadsheetId,
    sharedWith: email,
    role,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

async function readSpreadsheet(spreadsheetId: string, range: string) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return {
    spreadsheetId,
    range,
    values: (response.data.values as string[][]) || [],
  };
}

async function writeSpreadsheet(spreadsheetId: string, range: string, values: string[][]) {
  const response = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  return {
    updatedCells: response.data.updatedCells || 0,
    updatedRange: response.data.updatedRange || range,
  };
}

async function appendToSpreadsheet(spreadsheetId: string, range: string, values: string[][]) {
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return {
    updatedCells: response.data.updates?.updatedCells || 0,
    updatedRange: response.data.updates?.updatedRange || range,
  };
}

const server = new Server(
  { name: "google-sheets", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_spreadsheet",
      description: "Create a new Google Spreadsheet with an optional title and sheet names. Returns the spreadsheet ID and URL.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "The title of the spreadsheet (default: 'Untitled')" },
          sheet_names: { type: "array", items: { type: "string" }, description: "Optional array of sheet/tab names to create" },
        },
        required: [],
      },
    },
    {
      name: "share_spreadsheet",
      description: "Share a Google Spreadsheet with an email address. Defaults to writer (edit) access.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: { type: "string", description: "The Google Spreadsheet ID" },
          email: { type: "string", description: "Email address to share with (defaults to mikecarcasole@gmail.com)" },
          role: { type: "string", enum: ["reader", "commenter", "writer"], description: "Permission level (default: writer)" },
        },
        required: ["spreadsheet_id"],
      },
    },
    {
      name: "get_spreadsheet_link",
      description: "Get the shareable link for a Google Spreadsheet by its ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: { type: "string", description: "The Google Spreadsheet ID" },
        },
        required: ["spreadsheet_id"],
      },
    },
    {
      name: "read_spreadsheet",
      description: "Read data from a Google Spreadsheet. Specify a range like 'Sheet1!A1:D10' or just 'A1:D10' for the first sheet.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: { type: "string", description: "The Google Spreadsheet ID" },
          range: { type: "string", description: "The A1 notation range to read (e.g., 'Sheet1!A1:D10' or 'A1:D10')" },
        },
        required: ["spreadsheet_id", "range"],
      },
    },
    {
      name: "write_spreadsheet",
      description: "Write data to a Google Spreadsheet. Overwrites existing data in the specified range.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: { type: "string", description: "The Google Spreadsheet ID" },
          range: { type: "string", description: "The A1 notation range to write to (e.g., 'Sheet1!A1' or 'A1')" },
          values: { type: "array", items: { type: "array", items: { type: "string" } }, description: "2D array of values to write" },
        },
        required: ["spreadsheet_id", "range", "values"],
      },
    },
    {
      name: "append_to_spreadsheet",
      description: "Append rows to the end of data in a Google Spreadsheet.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: { type: "string", description: "The Google Spreadsheet ID" },
          range: { type: "string", description: "The A1 notation range that defines the table (e.g., 'Sheet1!A:D' or 'A:D')" },
          values: { type: "array", items: { type: "array", items: { type: "string" } }, description: "2D array of rows to append" },
        },
        required: ["spreadsheet_id", "range", "values"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "create_spreadsheet") {
    const { title = "Untitled", sheet_names } = (args as any) || {};
    try {
      const result = await createSpreadsheet(title, sheet_names);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to create spreadsheet: ${error}` }], isError: true };
    }
  }

  if (name === "share_spreadsheet") {
    const { spreadsheet_id, email = "mikecarcasole@gmail.com", role = "writer" } = args as any;
    try {
      const result = await shareSpreadsheet(spreadsheet_id, email, role);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to share spreadsheet: ${error}` }], isError: true };
    }
  }

  if (name === "get_spreadsheet_link") {
    const { spreadsheet_id } = args as { spreadsheet_id: string };
    try {
      await sheets.spreadsheets.get({ spreadsheetId: spreadsheet_id });
      return { content: [{ type: "text", text: `https://docs.google.com/spreadsheets/d/${spreadsheet_id}/edit` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to get spreadsheet link: ${error}` }], isError: true };
    }
  }

  if (name === "read_spreadsheet") {
    const { spreadsheet_id, range } = args as { spreadsheet_id: string; range: string };
    try {
      const result = await readSpreadsheet(spreadsheet_id, range);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to read spreadsheet: ${error}` }], isError: true };
    }
  }

  if (name === "write_spreadsheet") {
    const { spreadsheet_id, range, values } = args as { spreadsheet_id: string; range: string; values: string[][] };
    try {
      const result = await writeSpreadsheet(spreadsheet_id, range, values);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to write to spreadsheet: ${error}` }], isError: true };
    }
  }

  if (name === "append_to_spreadsheet") {
    const { spreadsheet_id, range, values } = args as { spreadsheet_id: string; range: string; values: string[][] };
    try {
      const result = await appendToSpreadsheet(spreadsheet_id, range, values);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to append to spreadsheet: ${error}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Google Sheets server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
