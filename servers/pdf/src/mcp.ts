import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runHttpServer } from "@phouse/http-transport";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as mupdf from "mupdf";
import * as fs from "fs";
import * as path from "path";

// Parse command line arguments
const args = process.argv.slice(2);
const useHttp = args.includes("--http");
const portIndex = args.indexOf("--port");
const httpPort = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3014;


async function convertPdfToMarkdown(
  filePath: string,
  outputPath?: string
): Promise<{ markdown: string; outputPath?: string; pageCount: number }> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF not found: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = doc.countPages();

  const lines: string[] = [];
  lines.push(`# ${path.basename(filePath)}`);
  lines.push("");
  lines.push(`*${pageCount} pages*`);
  lines.push("");

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const text = page.toStructuredText("preserve-whitespace").asText().trim();

    if (text) {
      lines.push("---");
      lines.push(`## Page ${i + 1}`);
      lines.push("");
      lines.push(text);
      lines.push("");
    }
  }

  const markdown = lines.join("\n");

  if (outputPath) {
    fs.writeFileSync(outputPath, markdown, "utf-8");
    return { markdown, outputPath, pageCount };
  }

  return { markdown, pageCount };
}

async function convertPdfToImages(
  filePath: string,
  outputDir: string,
  dpi: number = 150
): Promise<{ images: string[]; pageCount: number }> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF not found: ${filePath}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const buffer = fs.readFileSync(filePath);
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = doc.countPages();
  const images: string[] = [];
  const baseName = path.basename(filePath, ".pdf");

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const scale = dpi / 72; // 72 is the default DPI
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );

    const imagePath = path.join(outputDir, `${baseName}_page_${i + 1}.png`);
    const pngBuffer = pixmap.asPNG();
    fs.writeFileSync(imagePath, pngBuffer);
    images.push(imagePath);
  }

  return { images, pageCount };
}

const server = new Server(
  { name: "pdf", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "convert_pdf_to_markdown",
      description:
        "Convert a PDF file to markdown format. Extracts text from all pages. Optionally saves to a file.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the PDF file to convert",
          },
          output_path: {
            type: "string",
            description:
              "Optional path to save the markdown file. If not provided, returns the markdown directly.",
          },
        },
        required: ["file_path"],
      },
    },
    {
      name: "convert_pdf_to_images",
      description:
        "Convert each page of a PDF to PNG images. Useful for PDFs with complex layouts or when you need to see the visual content.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the PDF file to convert",
          },
          output_dir: {
            type: "string",
            description: "Directory where the PNG images will be saved",
          },
          dpi: {
            type: "number",
            description: "Resolution in DPI (default: 150). Higher = better quality but larger files.",
          },
        },
        required: ["file_path", "output_dir"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "convert_pdf_to_markdown") {
    const { file_path, output_path } = args as {
      file_path: string;
      output_path?: string;
    };
    try {
      const result = await convertPdfToMarkdown(file_path, output_path);
      if (output_path) {
        return {
          content: [
            {
              type: "text",
              text: `Converted ${result.pageCount} pages to markdown.\nSaved to: ${result.outputPath}`,
            },
          ],
        };
      }
      return { content: [{ type: "text", text: result.markdown }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to convert PDF: ${error}` }],
        isError: true,
      };
    }
  }

  if (name === "convert_pdf_to_images") {
    const { file_path, output_dir, dpi = 150 } = args as {
      file_path: string;
      output_dir: string;
      dpi?: number;
    };
    try {
      const result = await convertPdfToImages(file_path, output_dir, dpi);
      return {
        content: [
          {
            type: "text",
            text: `Converted ${result.pageCount} pages to images:\n${result.images.join("\n")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Failed to convert PDF to images: ${error}` },
        ],
        isError: true,
      };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function main() {
  if (useHttp) {
    // HTTP mode - run as persistent server
    console.error(`[MCP] Pdf server starting in HTTP mode on port ${httpPort}`);
    await runHttpServer(server, { port: httpPort, name: "pdf" });
  } else {
    // Stdio mode - traditional subprocess
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCP] Pdf server running (stdio)");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
