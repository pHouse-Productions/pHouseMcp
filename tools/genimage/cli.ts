#!/usr/bin/env node
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "..", "..", ".env") });

import { generateImage } from "./genimage.js";
import type { AspectRatio, ImageSize } from "../common/schemas.js";

const HELP_TEXT = `
Image generation script using OpenRouter

Usage:
  genimage "your prompt here" output.png [options]

Arguments:
  prompt                     Text prompt for image generation
  output                     Output file path (e.g., my_image.png)

Options:
  -a, --aspect-ratio RATIO   Aspect ratio (default: 1:1)
                             Options: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
  -s, --size SIZE           Image size (default: 1K)
                             Options: 1K, 2K, 4K
  --pro                     Use Pro model (google/gemini-3-pro-image-preview)
                             Default: google/gemini-2.5-flash-image
  -v, --verbose             Show full API response (including raw JSON)
  -h, --help                Show this help message

Examples:
  genimage "a cat on a skateboard" cat.png
  genimage "sunset" sunset.png -a 16:9 -s 2K
  genimage "landscape" landscape.png --pro
  genimage "test" test.png -v
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

  if (args.length < 2) {
    console.error("Error: Both prompt and output path are required");
    printHelp();
    process.exit(1);
  }

  const prompt = args[0];
  const outputPath = args[1];

  let aspectRatio: AspectRatio | undefined;
  let imageSize: ImageSize | undefined;
  let usePro = false;
  let verbose = false;

  for (let i = 2; i < args.length; i++) {
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
    const result = await generateImage({
      prompt,
      outputPath,
      aspectRatio,
      imageSize,
      usePro,
      verbose,
    });

    console.log(`✓ Saved to: ${result.outputPath}`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
