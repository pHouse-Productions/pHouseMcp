/**
 * MCP Gateway Server
 * Hosts multiple MCP servers on different paths of a single HTTP server.
 * Only loads servers if their required tokens/credentials are present.
 *
 * Usage:
 *   node dist/gateway.js --port 3000
 *
 * Environment variables:
 *   OPENROUTER_API_KEY - Required for image-gen
 *   TELEGRAM_BOT_TOKEN - Required for telegram
 *   DISCORD_BOT_TOKEN - Required for discord
 *   FINNHUB_API_KEY - Required for finnhub
 *   GOOGLE_PLACES_API_KEY - Required for google-places
 *   Google servers require credentials in ~/.config/phouse/ or via env vars
 *   (cron and pdf have no requirements)
 */
import { createGatewayServer } from "./lib/http-transport.js";
import { createServer as createImageGenServer } from "./servers/image-gen.js";
import { createServer as createTelegramServer } from "./servers/telegram.js";
import { createServer as createCronServer } from "./servers/cron.js";
import { createServer as createFinnhubServer } from "./servers/finnhub.js";
import { createServer as createGooglePlacesServer } from "./servers/google-places.js";
import { createServer as createPdfServer } from "./servers/pdf.js";
import { createServer as createGmailServer } from "./servers/gmail.js";
import { createServer as createCalendarServer } from "./servers/google-calendar.js";
import { createServer as createDriveServer } from "./servers/google-drive.js";
import { createServer as createDocsServer } from "./servers/google-docs.js";
import { createServer as createSheetsServer } from "./servers/google-sheets.js";
import { createServer as createChatServer } from "./servers/google-chat.js";
import { createServer as createDiscordServer } from "./servers/discord.js";
import * as path from "path";
import * as fs from "fs";
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
  create: () => Promise<any>;
  checkFn?: () => { ok: boolean; missing?: string };
}

function checkEnvVars(vars: string[]): boolean {
  return vars.every((v) => !!process.env[v]);
}

// Check for Google OAuth credentials (env vars or default paths)
function checkGoogleCredentials(): { ok: boolean; missing?: string } {
  const configDir = path.join(process.env.HOME || "", ".config", "phouse");
  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || path.join(configDir, "google_credentials.json");
  const tokenPath = process.env.GOOGLE_TOKEN_PATH || path.join(configDir, "google_token.json");

  if (!fs.existsSync(credentialsPath)) {
    return { ok: false, missing: `credentials (${credentialsPath})` };
  }
  if (!fs.existsSync(tokenPath)) {
    return { ok: false, missing: `token (${tokenPath})` };
  }
  return { ok: true };
}

async function main() {
  console.log(`[gateway] Starting MCP Gateway on port ${port}...`);

  // Create the gateway
  const gateway = await createGatewayServer({ port });

  const serverConfigs: ServerConfig[] = [
    {
      name: "image-gen",
      path: "/image-gen",
      requiredEnv: ["OPENROUTER_API_KEY"],
      create: createImageGenServer,
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
    {
      name: "pdf",
      path: "/pdf",
      requiredEnv: [],
      create: createPdfServer,
    },
    {
      name: "gmail",
      path: "/gmail",
      requiredEnv: [],
      checkFn: checkGoogleCredentials,
      create: createGmailServer,
    },
    {
      name: "google-calendar",
      path: "/google-calendar",
      requiredEnv: [],
      checkFn: checkGoogleCredentials,
      create: createCalendarServer,
    },
    {
      name: "google-drive",
      path: "/google-drive",
      requiredEnv: [],
      checkFn: checkGoogleCredentials,
      create: createDriveServer,
    },
    {
      name: "google-docs",
      path: "/google-docs",
      requiredEnv: [],
      checkFn: checkGoogleCredentials,
      create: createDocsServer,
    },
    {
      name: "google-sheets",
      path: "/google-sheets",
      requiredEnv: [],
      checkFn: checkGoogleCredentials,
      create: createSheetsServer,
    },
    {
      name: "google-chat",
      path: "/google-chat",
      requiredEnv: [],
      checkFn: checkGoogleCredentials,
      create: createChatServer,
    },
    {
      name: "discord",
      path: "/discord",
      requiredEnv: ["DISCORD_BOT_TOKEN"],
      create: createDiscordServer,
    },
  ];

  const loadedServers: string[] = [];
  const skippedServers: string[] = [];

  for (const cfg of serverConfigs) {
    // Check required env vars
    if (!checkEnvVars(cfg.requiredEnv)) {
      const missing = cfg.requiredEnv.filter((v) => !process.env[v]);
      console.log(`[gateway] Skipping ${cfg.name} - missing: ${missing.join(", ")}`);
      skippedServers.push(cfg.name);
      continue;
    }

    // Check custom function if provided
    if (cfg.checkFn) {
      const check = cfg.checkFn();
      if (!check.ok) {
        console.log(`[gateway] Skipping ${cfg.name} - missing: ${check.missing}`);
        skippedServers.push(cfg.name);
        continue;
      }
    }

    try {
      const server = await cfg.create();
      gateway.mount(cfg.path, server, cfg.name);
      loadedServers.push(cfg.name);
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
    if (cfg) console.log(`[gateway]   - http://127.0.0.1:${port}${cfg.path}/mcp`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
