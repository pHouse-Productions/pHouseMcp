/**
 * Disk-based artifact storage for generated files (images, etc.)
 *
 * Structure:
 *   artifacts/
 *     image-gen/
 *       {uuid}.png
 *     pdf/
 *       {uuid}.png
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Artifacts directory at project root
const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");

/**
 * Get the artifacts directory for a specific tool, creating it if needed.
 */
function getToolDir(tool: string): string {
  const dir = path.join(ARTIFACTS_DIR, tool);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Store an artifact to disk.
 * @param tool - Tool name (used as subdirectory)
 * @param data - File contents
 * @param extension - File extension (e.g., "png", "jpg")
 * @returns The artifact ID (UUID)
 */
export function storeArtifact(tool: string, data: Buffer, extension: string = "png"): string {
  const id = randomUUID();
  const dir = getToolDir(tool);
  const filename = `${id}.${extension}`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, data);
  console.log(`[artifacts] Stored ${tool}/${filename} (${data.length} bytes)`);

  return id;
}

/**
 * Get an artifact from disk.
 * @param tool - Tool name
 * @param id - Artifact ID (UUID)
 * @returns File contents and mime type, or null if not found
 */
export function getArtifact(tool: string, id: string): { data: Buffer; mimeType: string } | null {
  const dir = getToolDir(tool);

  // Find the file (we don't know the extension)
  const files = fs.readdirSync(dir);
  const match = files.find(f => f.startsWith(id));

  if (!match) {
    return null;
  }

  const filePath = path.join(dir, match);
  const data = fs.readFileSync(filePath);

  // Determine mime type from extension
  const ext = path.extname(match).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  const mimeType = mimeTypes[ext] || "application/octet-stream";

  return { data, mimeType };
}

/**
 * Delete an artifact.
 */
export function deleteArtifact(tool: string, id: string): boolean {
  const dir = getToolDir(tool);
  const files = fs.readdirSync(dir);
  const match = files.find(f => f.startsWith(id));

  if (!match) {
    return false;
  }

  fs.unlinkSync(path.join(dir, match));
  return true;
}

/**
 * List all artifacts for a tool.
 */
export function listArtifacts(tool: string): string[] {
  const dir = getToolDir(tool);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).map(f => path.basename(f, path.extname(f)));
}

/**
 * Get the artifacts base directory.
 */
export function getArtifactsDir(): string {
  return ARTIFACTS_DIR;
}

/**
 * Store an artifact and return the absolute file path.
 */
export function storeArtifactWithPath(tool: string, data: Buffer, extension: string = "png"): string {
  const id = randomUUID();
  const dir = getToolDir(tool);
  const filename = `${id}.${extension}`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, data);
  console.log(`[artifacts] Stored ${tool}/${filename} (${data.length} bytes)`);

  return filePath;
}
