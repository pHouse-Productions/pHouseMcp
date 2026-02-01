/**
 * Shared HTTP transport wrapper for MCP servers.
 * Allows servers to run as persistent HTTP services instead of stdio subprocesses.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import express, { Express } from "express";

export interface HttpServerOptions {
  port: number;
  name: string;
  host?: string;
}

export interface HttpServerResult {
  app: Express;
  close: () => Promise<void>;
}

/**
 * Start an MCP server with HTTP transport.
 * Multiple Claude sessions can connect to the same server instance.
 */
export async function startHttpServer(
  server: Server,
  options: HttpServerOptions
): Promise<HttpServerResult> {
  const { port, name, host = "127.0.0.1" } = options;
  const app = express();
  app.use(express.json());

  // Track transports by session ID
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // Helper to check if request is initialize
  const isInitializeRequest = (body: unknown): boolean => {
    return (
      typeof body === "object" &&
      body !== null &&
      "method" in body &&
      (body as { method: string }).method === "initialize"
    );
  };

  // MCP endpoint - handles POST, GET, DELETE
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Existing session
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New session - create transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            console.log(`[${name}] Session initialized: ${sid}`);
            transports[sid] = transport;
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.log(`[${name}] Session closed: ${sid}`);
            delete transports[sid];
          }
        };

        // Connect the server to this transport
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[${name}] Error handling request:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Handle GET requests for SSE streams
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // Handle DELETE requests for session termination
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      name,
      sessions: Object.keys(transports).length,
    });
  });

  // Start the server
  const httpServer = app.listen(port, host, () => {
    console.log(`[${name}] MCP HTTP server running at http://${host}:${port}/mcp`);
  });

  // Shutdown function
  const close = async (): Promise<void> => {
    console.log(`[${name}] Shutting down...`);
    for (const sessionId of Object.keys(transports)) {
      try {
        await transports[sessionId].close();
        delete transports[sessionId];
      } catch (error) {
        console.error(`[${name}] Error closing session ${sessionId}:`, error);
      }
    }
    return new Promise((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  return { app, close };
}

/**
 * Run server with graceful shutdown handling.
 * Call this in your main() function.
 */
export async function runHttpServer(
  server: Server,
  options: HttpServerOptions
): Promise<void> {
  const { close } = await startHttpServer(server, options);

  const shutdown = async () => {
    await close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
