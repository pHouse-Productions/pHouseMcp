import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

const MODEL_FLASH = "google/gemini-2.5-flash-image";
const MODEL_PRO = "google/gemini-3-pro-image-preview";

export type AspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
export type ImageSize = "1K" | "2K" | "4K";

export interface GenerateImageOptions {
  prompt: string;
  outputPath: string;
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
  usePro?: boolean;
  verbose?: boolean;
}

export interface GenerateImageResult {
  outputPath: string;
  model: string;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      images?: Array<{
        image_url?: {
          url: string;
        };
      }>;
    };
  }>;
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  const {
    prompt,
    outputPath,
    aspectRatio = "1:1",
    imageSize = "1K",
    usePro = false,
    verbose = false,
  } = options;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY must be set in .env file");
  }

  const model = usePro ? MODEL_PRO : MODEL_FLASH;

  const payload = {
    model,
    messages: [{ role: "user", content: prompt }],
    modalities: ["image", "text"],
    image_config: {
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
    reasoning: {
      exclude: true,
    },
  };

  if (verbose) {
    console.log("\n=== Request Details ===");
    console.log(`Model: ${model}`);
    console.log(`Aspect Ratio: ${aspectRatio}`);
    console.log(`Image Size: ${imageSize}`);
    console.log(`Prompt: ${prompt}`);
    console.log("\n=== Request Payload ===");
    console.log(JSON.stringify(payload, null, 2));
    console.log("======================\n");
  } else {
    console.log(`Model: ${model}`);
    console.log(`Aspect Ratio: ${aspectRatio}`);
    console.log(`Image Size: ${imageSize}`);
    console.log(`Generating: ${prompt}`);
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }

  const result = (await response.json()) as OpenRouterResponse;

  if (verbose) {
    console.log("\n=== Full API Response ===");
    console.log(JSON.stringify(result, null, 2));
    console.log("=== End Response ===\n");
  }

  const message = result.choices[0]?.message;
  if (!message?.images || message.images.length === 0) {
    throw new Error("No images in response");
  }

  const imageUrl = message.images[0].image_url?.url;
  if (!imageUrl) {
    throw new Error("No image URL in response");
  }

  let imageBytes: Buffer;

  if (imageUrl.startsWith("data:image/")) {
    // Base64 data URL
    const [, encoded] = imageUrl.split(",");
    imageBytes = Buffer.from(encoded, "base64");
  } else if (imageUrl.startsWith("http")) {
    // Regular URL
    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) {
      throw new Error(`Failed to fetch image: ${imgResponse.statusText}`);
    }
    imageBytes = Buffer.from(await imgResponse.arrayBuffer());
  } else {
    throw new Error(`Unknown image format: ${imageUrl.substring(0, 50)}`);
  }

  // Create output directory if needed
  await mkdir(dirname(outputPath), { recursive: true });

  // Write image file
  await writeFile(outputPath, imageBytes);

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
        enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
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
    const result = await generateImage({
      prompt: args.prompt,
      outputPath: args.outputPath,
      aspectRatio: args.aspectRatio as AspectRatio | undefined,
      imageSize: args.imageSize as ImageSize | undefined,
      usePro: args.usePro,
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
