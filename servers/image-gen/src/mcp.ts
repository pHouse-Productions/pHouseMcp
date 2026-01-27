import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OpenRouter } from "@openrouter/sdk/sdk/index.js";
import { readFile } from "fs/promises";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { z } from "zod";
import "dotenv/config";

// Model configuration
const MODEL_FLASH = "google/gemini-2.5-flash-image";
const MODEL_PRO = "google/gemini-3-pro-image-preview";

const getGeminiModel = (usePro: boolean) => (usePro ? MODEL_PRO : MODEL_FLASH);

// Validate API key
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY environment variable is required");
}

const openRouter = new OpenRouter({ apiKey });

// Utility to save base64 images
async function saveBase64Image(base64Data: string, outputPath: string): Promise<void> {
  let base64String: string;

  if (base64Data.startsWith("data:")) {
    const [, encoded] = base64Data.split(",");
    if (!encoded) {
      throw new Error("Invalid base64 data URL format");
    }
    base64String = encoded;
  } else {
    base64String = base64Data;
  }

  const imageBytes = Buffer.from(base64String, "base64");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, imageBytes);
}

// Generate image function
async function generateImage(options: {
  prompt: string;
  outputPath: string;
  aspectRatio?: string;
  imageSize?: string;
  usePro?: boolean;
}) {
  const {
    prompt,
    outputPath,
    aspectRatio = "1:1",
    imageSize = "1K",
    usePro = false,
  } = options;

  const model = getGeminiModel(usePro);
  console.error(`[image-gen] Generating with ${model}: ${prompt.substring(0, 50)}...`);

  const result = await openRouter.chat.send({
    messages: [{ role: "user", content: prompt }],
    model,
    imageConfig: {
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
  });

  const base64ImageResponse = result.choices[0]?.message.images?.[0]?.imageUrl?.url;
  if (!base64ImageResponse) {
    throw new Error("No image returned from generation request");
  }

  await saveBase64Image(base64ImageResponse, outputPath);

  return { outputPath, model, aspectRatio, imageSize };
}

// Edit image function
async function editImage(options: {
  prompt: string;
  inputImage: string;
  outputPath: string;
  aspectRatio?: string;
  imageSize?: string;
  usePro?: boolean;
}) {
  const {
    prompt,
    inputImage,
    outputPath,
    aspectRatio = "1:1",
    imageSize = "1K",
    usePro = false,
  } = options;

  const imageBuffer = await readFile(inputImage);
  const base64Image = imageBuffer.toString("base64");
  const model = getGeminiModel(usePro);

  console.error(`[image-gen] Editing ${inputImage} with ${model}`);

  const result = await openRouter.chat.send({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            imageUrl: { url: `data:image/png;base64,${base64Image}` },
          },
        ],
      },
    ],
    model,
    imageConfig: {
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
  });

  const base64ImageResponse = result.choices[0]?.message.images?.[0]?.imageUrl?.url;
  if (!base64ImageResponse) {
    throw new Error("No image returned from edit request");
  }

  await saveBase64Image(base64ImageResponse, outputPath);

  return { outputPath, model, aspectRatio, imageSize };
}

// MCP Server setup
const server = new Server(
  { name: "image-gen", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description:
        "Generate an image using Gemini via OpenRouter and save it to a file",
      inputSchema: {
        type: "object" as const,
        properties: {
          prompt: {
            type: "string",
            description: "The prompt describing the image to generate",
          },
          outputPath: {
            type: "string",
            description: "Path where the image should be saved (e.g., /tmp/image.png)",
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
        required: ["prompt", "outputPath"],
      },
    },
    {
      name: "edit_image",
      description:
        "Edit an image using AI with a text prompt. Takes an input image and applies transformations based on the prompt.",
      inputSchema: {
        type: "object" as const,
        properties: {
          prompt: {
            type: "string",
            description: "Text prompt describing the desired edits",
          },
          inputImage: {
            type: "string",
            description: "Path to the input image file",
          },
          outputPath: {
            type: "string",
            description: "Path where the edited image should be saved",
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
        required: ["prompt", "inputImage", "outputPath"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "generate_image") {
    const { prompt, outputPath, aspectRatio, imageSize, usePro } = args as {
      prompt: string;
      outputPath: string;
      aspectRatio?: string;
      imageSize?: string;
      usePro?: boolean;
    };

    try {
      const result = await generateImage({ prompt, outputPath, aspectRatio, imageSize, usePro });
      return {
        content: [
          {
            type: "text",
            text: `Generated image saved to: ${result.outputPath}\nModel: ${result.model}\nAspect Ratio: ${result.aspectRatio}\nImage Size: ${result.imageSize}`,
          },
        ],
      };
    } catch (error) {
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
      outputPath: string;
      aspectRatio?: string;
      imageSize?: string;
      usePro?: boolean;
    };

    try {
      const result = await editImage({ prompt, inputImage, outputPath, aspectRatio, imageSize, usePro });
      return {
        content: [
          {
            type: "text",
            text: `Edited image saved to: ${result.outputPath}\nModel: ${result.model}\nAspect Ratio: ${result.aspectRatio}\nImage Size: ${result.imageSize}`,
          },
        ],
      };
    } catch (error) {
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Image Generation server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
