import { config } from "dotenv";
import { memoize } from "lodash-es";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const initDotEnv = memoize(() => {
  // Load .env from the project root directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  config({ path: join(__dirname, "..", "..", ".env") });
});
