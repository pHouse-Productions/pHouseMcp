/**
 * PDF MCP Server - Extracts text from PDFs
 * Uses pdf-parse to convert PDF to text and saves to file.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { PDFParse } from "pdf-parse";
import { storeArtifactWithPath } from "../lib/artifacts.js";

const TOOL_NAME = "pdf";

/**
 * Create and configure the pdf MCP server.
 */
export async function createServer(): Promise<Server> {
  const server = new Server(
    { name: "pdf", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "pdf_to_text",
        description:
          "Extract text from a PDF file and save it to a text file. Returns the absolute path to the output file.",
        inputSchema: {
          type: "object" as const,
          properties: {
            pdfPath: {
              type: "string",
              description: "Absolute path to the PDF file to extract text from",
            },
            outputPath: {
              type: "string",
              description:
                "Optional path where the text file should be saved. If not provided, saves to artifacts directory.",
            },
          },
          required: ["pdfPath"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "pdf_to_text") {
      const { pdfPath, outputPath } = args as {
        pdfPath: string;
        outputPath?: string;
      };

      try {
        console.error(`[pdf] Parsing: ${pdfPath}`);

        const pdfBuffer = await readFile(pdfPath);
        const parser = new PDFParse({ data: pdfBuffer });
        const result = await parser.getText();
        await parser.destroy();

        const text = result.text;
        let savedPath: string;

        if (outputPath) {
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, text, "utf-8");
          savedPath = outputPath;
        } else {
          const textBuffer = Buffer.from(text, "utf-8");
          savedPath = storeArtifactWithPath(TOOL_NAME, textBuffer, "txt");
        }

        return {
          content: [
            {
              type: "text",
              text: `Extracted text saved to: ${savedPath}\nPages: ${result.pages.length}\nCharacters: ${text.length}`,
            },
          ],
        };
      } catch (error) {
        console.error("[pdf] Error:", error);
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to parse PDF: ${errMsg}` }],
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
