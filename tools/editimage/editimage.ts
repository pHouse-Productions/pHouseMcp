import { OpenRouter } from "@openrouter/sdk/sdk/index.js";
import { readFile } from "fs/promises";
import z from "zod";
import { initDotEnv } from "../../src/initDotEnv.js";
import { saveBase64Image } from "../common/fileUtils.js";
import { EditImageSchema, type EditImageOptions } from "../common/schemas.js";
import { getGeminiModel } from "../genimage/getGeminiModel.js";

initDotEnv();

export interface EditImageOptionsWithVerbose extends EditImageOptions {
  verbose?: boolean;
}

const openRouter = new OpenRouter({
  apiKey: z.string().parse(process.env.OPENROUTER_API_KEY),
});

export async function editImage(
  options: EditImageOptionsWithVerbose,
): Promise<void> {
  const {
    prompt,
    inputImage,
    outputPath,
    aspectRatio = "1:1",
    imageSize = "1K",
    usePro = false,
    verbose = false,
  } = options;

  // Read the input image and convert to base64
  const imageBuffer = await readFile(inputImage);
  const base64Image = imageBuffer.toString("base64");

  if (verbose) {
    console.log("\n=== Image Edit Details ===");
    console.log(`Prompt: ${prompt}`);
    console.log(`Input Image: ${inputImage}`);
    console.log(`Output Path: ${outputPath}`);
    console.log(`Aspect Ratio: ${aspectRatio}`);
    console.log(`Image Size: ${imageSize}`);
    console.log(`Use Pro: ${usePro}`);

    // Log the base64 image
    console.log("\n=== Base64 Image ===");
    console.log(base64Image);
    console.log("=== End Base64 ===\n");
  }

  const result = await openRouter.chat.send({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "image_url",
            imageUrl: {
              url: `data:image/png;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    model: getGeminiModel(usePro),
    imageConfig: {
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
  });

  const base64ImageResponse =
    result.choices[0].message.images?.[0].imageUrl.url;

  if (!base64ImageResponse) {
    throw new Error("No image returned from edit request");
  }

  if (verbose) {
    console.log("\n=== Edited Image Base64 ===");
    console.log(base64ImageResponse);
    console.log("=== End Edited Image Base64 ===\n");
  }

  await saveBase64Image(base64ImageResponse, outputPath);
}

// MCP Tool Definition
export const mcpTool = {
  name: "edit_image",
  description:
    "Edit an image using AI with a text prompt. Takes an input image and applies transformations based on the prompt. Supports the same aspect ratios and image sizes as generate_image.",
  inputSchema: {
    type: "object",
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
        description: "Output file path (e.g., edited_image.png)",
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
    required: ["prompt", "inputImage", "outputPath"],
  },
};

// MCP Tool Handler
export async function mcpHandler(args: any) {
  try {
    // Validate and parse arguments with Zod
    const parsed = EditImageSchema.parse(args);

    await editImage({
      ...parsed,
      verbose: false,
    });

    return {
      content: [
        {
          type: "text",
          text: "This should not be reached",
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
