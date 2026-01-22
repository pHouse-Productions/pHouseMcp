import { OpenRouter } from "@openrouter/sdk/sdk/index.js";
import z from "zod";
import { initDotEnv } from "../../src/initDotEnv.js";
import {
  GenerateImageSchema,
  type GenerateImageOptions,
} from "../common/schemas.js";
import { saveBase64Image } from "../common/fileUtils.js";
import { getGeminiModel } from "./getGeminiModel.js";

initDotEnv();

export interface GenerateImageOptionsWithVerbose extends GenerateImageOptions {
  verbose?: boolean;
}

export interface GenerateImageResult {
  outputPath: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
}

const openRouter = new OpenRouter({
  apiKey: z.string().parse(process.env.OPENROUTER_API_KEY),
});

export async function generateImage(
  options: GenerateImageOptionsWithVerbose,
): Promise<GenerateImageResult> {
  const {
    prompt,
    outputPath,
    aspectRatio = "1:1",
    imageSize = "1K",
    usePro = false,
    verbose = false,
  } = options;

  const model = getGeminiModel(usePro);

  if (verbose) {
    console.log("\n=== Request Details ===");
    console.log(`Model: ${model}`);
    console.log(`Aspect Ratio: ${aspectRatio}`);
    console.log(`Image Size: ${imageSize}`);
    console.log(`Prompt: ${prompt}`);
    console.log("======================\n");
  } else {
    console.log(`Model: ${model}`);
    console.log(`Aspect Ratio: ${aspectRatio}`);
    console.log(`Image Size: ${imageSize}`);
    console.log(`Generating: ${prompt}`);
  }

  const result = await openRouter.chat.send({
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    model,
    imageConfig: {
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
  });

  if (verbose) {
    console.log("\n=== Full API Response ===");
    console.log(JSON.stringify(result, null, 2));
    console.log("=== End Response ===\n");
  }

  const base64ImageResponse =
    result.choices[0]?.message.images?.[0]?.imageUrl?.url;

  if (!base64ImageResponse) {
    throw new Error("No image returned from generation request");
  }

  await saveBase64Image(base64ImageResponse, outputPath);

  return {
    outputPath,
    model,
    aspectRatio,
    imageSize,
  };
}

// MCP Tool Definition
export const mcpTool = {
  name: "generate_image",
  description:
    "Generate an image using OpenRouter's Gemini image generation models. Supports Flash (fast, cost-effective) and Pro (higher quality) models.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Text prompt for image generation",
      },
      outputPath: {
        type: "string",
        description: "Output file path (e.g., my_image.png)",
      },
      aspectRatio: {
        type: "string",
        enum: [
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9",
          "21:9",
        ],
        description: "Aspect ratio (default: 1:1)",
      },
      imageSize: {
        type: "string",
        enum: ["1K", "2K", "4K"],
        description: "Image size (default: 1K)",
      },
      usePro: {
        type: "boolean",
        description: "Use Pro model for higher quality (default: false)",
      },
    },
    required: ["prompt", "outputPath"],
  },
};

// MCP Tool Handler
export async function mcpHandler(args: any) {
  try {
    // Validate and parse arguments with Zod
    const parsed = GenerateImageSchema.parse(args);

    const result = await generateImage({
      ...parsed,
      verbose: false,
    });

    return {
      content: [
        {
          type: "text",
          text: `Successfully generated image and saved to: ${result.outputPath}\n\nModel: ${result.model}\nAspect Ratio: ${result.aspectRatio}\nImage Size: ${result.imageSize}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error generating image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
