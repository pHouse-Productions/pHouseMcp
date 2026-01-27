import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";

/**
 * Save a base64-encoded image to a file
 * @param base64Data - Base64 string (with or without data URL prefix)
 * @param outputPath - Path where the image should be saved
 */
export async function saveBase64Image(
  base64Data: string,
  outputPath: string
): Promise<void> {
  let base64String: string;

  // Handle data URL format (data:image/png;base64,...)
  if (base64Data.startsWith("data:")) {
    const [, encoded] = base64Data.split(",");
    if (!encoded) {
      throw new Error("Invalid base64 data URL format");
    }
    base64String = encoded;
  } else {
    // Assume it's already raw base64
    base64String = base64Data;
  }

  // Convert base64 to Buffer
  const imageBytes = Buffer.from(base64String, "base64");

  // Create output directory if needed
  await mkdir(dirname(outputPath), { recursive: true });

  // Write image file
  await writeFile(outputPath, imageBytes);
}
