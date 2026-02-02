/**
 * MCP Gateway Server
 * Hosts multiple MCP servers on different paths of a single HTTP server.
 * Only loads servers if their required tokens/credentials are present.
 *
 * Usage:
 *   node dist/gateway.js --port 3000
 *
 * Environment variables:
 *   MCP_PUBLIC_URL - Public URL for OAuth and image serving
 *   OPENROUTER_API_KEY - Required for image-gen
 *   TELEGRAM_BOT_TOKEN - Required for telegram
 *   FINNHUB_API_KEY - Required for finnhub
 *   GOOGLE_PLACES_API_KEY - Required for google-places
 *   (cron has no requirements)
 */
import { createGatewayServer } from "./lib/http-transport.js";
import { createServer as createImageGenServer, getImage } from "./servers/image-gen.js";
import { createServer as createTelegramServer } from "./servers/telegram.js";
import { createServer as createCronServer } from "./servers/cron.js";
import { createServer as createFinnhubServer } from "./servers/finnhub.js";
import { createServer as createGooglePlacesServer } from "./servers/google-places.js";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env") });

// Parse command line arguments
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3000;

// Server configurations
interface ServerConfig {
  name: string;
  path: string;
  requiredEnv: string[];
  create: (options?: any) => Promise<any>;
  setupCallback?: (gateway: any, publicUrl: string) => void;
}

function checkEnvVars(vars: string[]): boolean {
  return vars.every((v) => !!process.env[v]);
}

async function main() {
  const publicUrl = process.env.MCP_PUBLIC_URL || `http://127.0.0.1:${port}`;

  console.log(`[gateway] Starting MCP Gateway on port ${port}...`);
  console.log(`[gateway] Public URL: ${publicUrl}`);

  // Create the gateway
  const gateway = await createGatewayServer({ port });

  const serverConfigs: ServerConfig[] = [
    {
      name: "image-gen",
      path: "/image-gen",
      requiredEnv: ["OPENROUTER_API_KEY"],
      create: () => createImageGenServer({ publicBaseUrl: publicUrl, httpMode: true }),
      setupCallback: (gw, url) => {
        gw.app.get("/images/:id", (req: any, res: any) => {
          const image = getImage(req.params.id);
          if (!image) {
            res.status(404).send("Image not found or expired");
            return;
          }
          res.setHeader("Content-Type", image.mimeType);
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.send(image.data);
        });
        console.log(`[gateway] Image serving at ${url}/images/:id`);
      },
    },
    {
      name: "telegram",
      path: "/telegram",
      requiredEnv: ["TELEGRAM_BOT_TOKEN"],
      create: createTelegramServer,
    },
    {
      name: "cron",
      path: "/cron",
      requiredEnv: [],
      create: createCronServer,
    },
    {
      name: "finnhub",
      path: "/finnhub",
      requiredEnv: ["FINNHUB_API_KEY"],
      create: createFinnhubServer,
    },
    {
      name: "google-places",
      path: "/google-places",
      requiredEnv: ["GOOGLE_PLACES_API_KEY"],
      create: createGooglePlacesServer,
    },
  ];

  const loadedServers: string[] = [];
  const skippedServers: string[] = [];

  for (const cfg of serverConfigs) {
    if (!checkEnvVars(cfg.requiredEnv)) {
      const missing = cfg.requiredEnv.filter((v) => !process.env[v]);
      console.log(`[gateway] Skipping ${cfg.name} - missing: ${missing.join(", ")}`);
      skippedServers.push(cfg.name);
      continue;
    }

    try {
      const server = await cfg.create();
      gateway.mount(cfg.path, server, cfg.name);
      loadedServers.push(cfg.name);

      if (cfg.setupCallback) {
        cfg.setupCallback(gateway, publicUrl);
      }
    } catch (error) {
      console.error(`[gateway] Failed to load ${cfg.name}:`, (error as Error).message);
      skippedServers.push(cfg.name);
    }
  }

  // Shutdown handler
  const shutdown = async () => {
    await gateway.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[gateway] Gateway ready!`);
  console.log(`[gateway] Loaded ${loadedServers.length} server(s): ${loadedServers.join(", ") || "none"}`);
  if (skippedServers.length > 0) {
    console.log(`[gateway] Skipped ${skippedServers.length} server(s): ${skippedServers.join(", ")}`);
  }
  console.log(`[gateway] Endpoints:`);
  for (const name of loadedServers) {
    const cfg = serverConfigs.find((c) => c.name === name);
    if (cfg) console.log(`[gateway]   - ${publicUrl}${cfg.path}/mcp`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
