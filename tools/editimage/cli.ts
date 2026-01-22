#!/usr/bin/env node
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "..", "..", ".env") });

import { editImage } from "./editimage.js";
import type { AspectRatio, ImageSize } from "../common/schemas.js";

const HELP_TEXT = `
Image editing script using OpenRouter

Usage:
  editimage "your prompt here" input.png output.png [options]

Arguments:
  prompt                     Text prompt describing desired edits
  input                      Input image file path
  output                     Output file path (e.g., edited_image.png)

Options:
  -a, --aspect-ratio RATIO   Aspect ratio (default: 1:1)
                             Options: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
  -s, --size SIZE           Image size (default: 1K)
                             Options: 1K, 2K, 4K
  --pro                     Use Pro model (google/gemini-3-pro-image-preview)
                             Default: google/gemini-2.5-flash-image
  -v, --verbose             Show full details (including base64 output)
  -h, --help                Show this help message

Examples:
  editimage "make it sepia toned" photo.jpg edited.png
  editimage "add a blue filter" image.png output.png -a 16:9 -s 2K
  editimage "make it darker" photo.jpg dark.png --pro
`;

function printHelp() {
  console.log(HELP_TEXT);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(args.length > 0 ? 0 : 1);
  }

  if (args.length < 3) {
    console.error("Error: Prompt, input path, and output path are required");
    printHelp();
    process.exit(1);
  }

  const prompt = args[0];
  const inputImage = args[1];
  const outputPath = args[2];

  let aspectRatio: AspectRatio | undefined;
  let imageSize: ImageSize | undefined;
  let usePro = false;
  let verbose = false;

  for (let i = 3; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-a" || arg === "--aspect-ratio") {
      aspectRatio = args[++i] as AspectRatio;
    } else if (arg === "-s" || arg === "--size") {
      imageSize = args[++i] as ImageSize;
    } else if (arg === "--pro") {
      usePro = true;
    } else if (arg === "-v" || arg === "--verbose") {
      verbose = true;
    } else {
      console.error(`Error: Unknown option '${arg}'`);
      printHelp();
      process.exit(1);
    }
  }

  try {
    await editImage({
      prompt,
      inputImage,
      outputPath,
      aspectRatio,
      imageSize,
      usePro,
      verbose,
    });
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
