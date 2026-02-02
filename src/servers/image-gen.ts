/**
 * Image Generation MCP Server - Exportable module
 * Can be imported by the gateway or run standalone via mcp.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OpenRouter } from "@openrouter/sdk/sdk/index.js";
import { readFile } from "fs/promises";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { randomUUID } from "crypto";

// Model configuration
const MODEL_FLASH = "google/gemini-2.5-flash-image";
const MODEL_PRO = "google/gemini-3-pro-image-preview";

const getGeminiModel = (usePro: boolean) => (usePro ? MODEL_PRO : MODEL_FLASH);

// In-memory image store for HTTP mode (images expire after 1 hour)
const imageStore = new Map<string, { data: Buffer; mimeType: string; expiresAt: number }>();
const IMAGE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function storeImage(imageData: Buffer, mimeType: string = "image/png"): string {
  const id = randomUUID();
  imageStore.set(id, {
    data: imageData,
    mimeType,
    expiresAt: Date.now() + IMAGE_TTL_MS,
  });
  return id;
}

export function getImage(id: string): { data: Buffer; mimeType: string } | null {
  const image = imageStore.get(id);
  if (!image) return null;
  if (Date.now() > image.expiresAt) {
    imageStore.delete(id);
    return null;
  }
  return { data: image.data, mimeType: image.mimeType };
}

// Clean up expired images periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, image] of imageStore) {
    if (now > image.expiresAt) {
      imageStore.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Utility to decode base64 images
function decodeBase64Image(base64Data: string): Buffer {
  let base64String: string;
  if (base64Data.startsWith("data:")) {
    const [, encoded] = base64Data.split(",");
    if (!encoded) throw new Error("Invalid base64 data URL format");
    base64String = encoded;
  } else {
    base64String = base64Data;
  }
  return Buffer.from(base64String, "base64");
}

// Utility to save base64 images to file
async function saveBase64Image(base64Data: string, outputPath: string): Promise<void> {
  const imageBytes = decodeBase64Image(base64Data);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, imageBytes);
}

export interface CreateServerOptions {
  /** Public base URL for image serving (e.g., https://example.com) */
  publicBaseUrl?: string;
  /** Whether running in HTTP mode (enables URL-based image returns) */
  httpMode?: boolean;
}

/**
 * Create and configure the image-gen MCP server.
 */
export async function createServer(options: CreateServerOptions = {}): Promise<Server> {
  const { publicBaseUrl, httpMode = false } = options;

  // Validate API key
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }

  const openRouter = new OpenRouter({ apiKey });

  const server = new Server(
    { name: "image-gen", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "generate_image",
        description:
          "Generate an image using Gemini via OpenRouter. Returns a URL to the image (in HTTP mode) or saves to file.",
        inputSchema: {
          type: "object" as const,
          properties: {
            prompt: {
              type: "string",
              description: "The prompt describing the image to generate",
            },
            outputPath: {
              type: "string",
              description: "Path where the image should be saved. Optional in HTTP mode (returns URL instead).",
            },
            aspectRatio: {
              type: "string",
              enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
              description: "Aspect ratio of the image (default: 1:1)",
            },
            imageSize: {
              type: "string",
              enum: ["1K", "2K", "4K"],
              description: "Size of the image (default: 1K)",
            },
            usePro: {
              type: "boolean",
              description: "Use the Pro model instead of Flash (default: false)",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "edit_image",
        description:
          "Edit an image using AI with a text prompt. Takes an input image (path or URL) and applies transformations.",
        inputSchema: {
          type: "object" as const,
          properties: {
            prompt: {
              type: "string",
              description: "Text prompt describing the desired edits",
            },
            inputImage: {
              type: "string",
              description: "Path to the input image file, or URL to fetch the image from",
            },
            outputPath: {
              type: "string",
              description: "Path where the edited image should be saved. Optional in HTTP mode.",
            },
            aspectRatio: {
              type: "string",
              enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"],
              description: "Aspect ratio of the output image (default: 1:1)",
            },
            imageSize: {
              type: "string",
              enum: ["1K", "2K", "4K"],
              description: "Size of the output image (default: 1K)",
            },
            usePro: {
              type: "boolean",
              description: "Use the Pro model instead of Flash (default: false)",
            },
          },
          required: ["prompt", "inputImage"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "generate_image") {
      const { prompt, outputPath, aspectRatio, imageSize, usePro } = args as {
        prompt: string;
        outputPath?: string;
        aspectRatio?: string;
        imageSize?: string;
        usePro?: boolean;
      };

      try {
        const model = getGeminiModel(usePro || false);
        console.error(`[image-gen] Generating with ${model}: ${prompt.substring(0, 50)}...`);

        const result = await openRouter.chat.send({
          messages: [{ role: "user", content: prompt }],
          model,
          imageConfig: {
            aspect_ratio: aspectRatio || "1:1",
            image_size: imageSize || "1K",
          },
        });

        const base64ImageResponse = result.choices[0]?.message.images?.[0]?.imageUrl?.url;
        if (!base64ImageResponse) {
          throw new Error("No image returned from generation request");
        }

        // HTTP mode without outputPath - store and return URL
        if (httpMode && !outputPath && publicBaseUrl) {
          const imageBuffer = decodeBase64Image(base64ImageResponse);
          const imageId = storeImage(imageBuffer);
          const imageUrl = `${publicBaseUrl}/images/${imageId}`;

          return {
            content: [{
              type: "text",
              text: `Generated image: ${imageUrl}\nModel: ${model}\nAspect Ratio: ${aspectRatio || "1:1"}\nImage Size: ${imageSize || "1K"}`,
            }],
          };
        }

        // File mode
        if (!outputPath) {
          return {
            content: [{ type: "text", text: "outputPath is required when not in HTTP mode" }],
            isError: true,
          };
        }

        await saveBase64Image(base64ImageResponse, outputPath);
        return {
          content: [{
            type: "text",
            text: `Generated image saved to: ${outputPath}\nModel: ${model}\nAspect Ratio: ${aspectRatio || "1:1"}\nImage Size: ${imageSize || "1K"}`,
          }],
        };
      } catch (error) {
        console.error("[image-gen] Generate error:", error);
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to generate image: ${errMsg}` }],
          isError: true,
        };
      }
    }

    if (name === "edit_image") {
      const { prompt, inputImage, outputPath, aspectRatio, imageSize, usePro } = args as {
        prompt: string;
        inputImage: string;
        outputPath?: string;
        aspectRatio?: string;
        imageSize?: string;
        usePro?: boolean;
      };

      try {
        // Load input image (support URLs)
        let imageBuffer: Buffer;
        if (inputImage.startsWith("http://") || inputImage.startsWith("https://")) {
          const response = await fetch(inputImage);
          if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
          imageBuffer = Buffer.from(await response.arrayBuffer());
        } else {
          imageBuffer = await readFile(inputImage);
        }

        const base64Image = imageBuffer.toString("base64");
        const model = getGeminiModel(usePro || false);

        console.error(`[image-gen] Editing image with ${model}`);

        const result = await openRouter.chat.send({
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", imageUrl: { url: `data:image/png;base64,${base64Image}` } },
            ],
          }],
          model,
          imageConfig: {
            aspect_ratio: aspectRatio || "1:1",
            image_size: imageSize || "1K",
          },
        });

        const base64ImageResponse = result.choices[0]?.message.images?.[0]?.imageUrl?.url;
        if (!base64ImageResponse) {
          throw new Error("No image returned from edit request");
        }

        // HTTP mode without outputPath - store and return URL
        if (httpMode && !outputPath && publicBaseUrl) {
          const outputBuffer = decodeBase64Image(base64ImageResponse);
          const imageId = storeImage(outputBuffer);
          const imageUrl = `${publicBaseUrl}/images/${imageId}`;

          return {
            content: [{
              type: "text",
              text: `Edited image: ${imageUrl}\nModel: ${model}\nAspect Ratio: ${aspectRatio || "1:1"}\nImage Size: ${imageSize || "1K"}`,
            }],
          };
        }

        // File mode
        if (!outputPath) {
          return {
            content: [{ type: "text", text: "outputPath is required when not in HTTP mode" }],
            isError: true,
          };
        }

        await saveBase64Image(base64ImageResponse, outputPath);
        return {
          content: [{
            type: "text",
            text: `Edited image saved to: ${outputPath}\nModel: ${model}\nAspect Ratio: ${aspectRatio || "1:1"}\nImage Size: ${imageSize || "1K"}`,
          }],
        };
      } catch (error) {
        console.error("[image-gen] Edit error:", error);
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to edit image: ${errMsg}` }],
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
