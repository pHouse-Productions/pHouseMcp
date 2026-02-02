/**
 * Shared HTTP transport wrapper for MCP servers.
 * Allows servers to run as persistent HTTP services instead of stdio subprocesses.
 * Supports OAuth2 authentication compatible with Claude Code connectors.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomUUID, createHash } from "node:crypto";
import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";

/**
 * In-memory store for OAuth authorization codes.
 * Maps code -> { codeChallenge, redirectUri, expiresAt }
 */
const authCodes = new Map<string, {
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}>();

/**
 * Verify PKCE code_verifier against stored code_challenge.
 */
function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method === "S256") {
    const hash = createHash("sha256").update(codeVerifier).digest("base64url");
    return hash === codeChallenge;
  } else if (method === "plain") {
    return codeVerifier === codeChallenge;
  }
  return false;
}

export interface HttpServerOptions {
  port: number;
  name: string;
  host?: string;
}

export interface HttpServerResult {
  app: Express;
  close: () => Promise<void>;
}

export interface GatewayServerOptions {
  port: number;
  host?: string;
}

export interface GatewayServerResult {
  app: Express;
  mount: (basePath: string, server: Server, name: string) => void;
  close: () => Promise<void>;
}

export interface MountOptions {
  basePath: string;
  name: string;
}

/**
 * Auth configuration from environment variables:
 * - MCP_AUTH_CLIENT_ID: OAuth client ID (optional, for identification)
 * - MCP_AUTH_CLIENT_SECRET: OAuth client secret (required for auth)
 * - MCP_PUBLIC_URL: Public URL for OAuth metadata (for use behind ngrok/proxy)
 */
function getAuthConfig() {
  return {
    clientId: process.env.MCP_AUTH_CLIENT_ID || "mcp-client",
    clientSecret: process.env.MCP_AUTH_CLIENT_SECRET || "",
    publicUrl: process.env.MCP_PUBLIC_URL || "",
    enabled: !!process.env.MCP_AUTH_CLIENT_SECRET,
  };
}

/**
 * Create a simple token verifier that validates against static client credentials.
 * For production with multiple clients, you'd use a real OAuth server.
 */
function createStaticTokenVerifier(clientId: string, clientSecret: string, serverUrl: URL) {
  return {
    verifyAccessToken: async (token: string) => {
      // Simple validation: token must match the client secret
      // In production, you'd validate against an OAuth server
      if (token !== clientSecret) {
        throw new Error("Invalid token");
      }

      return {
        token,
        clientId,
        scopes: ["mcp:tools"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      };
    },
  };
}

/**
 * Request logging middleware.
 */
function createRequestLogger(serverName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      console.log(`[${serverName}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
    });
    next();
  };
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
  const authConfig = getAuthConfig();

  const app = express();

  // Parse both JSON and URL-encoded bodies (OAuth token endpoint uses form data)
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS support - allow all origins and methods for OAuth compatibility
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
      exposedHeaders: ["Mcp-Session-Id"],
    })
  );

  // Request logging
  app.use(createRequestLogger(name));

  // Server URL for OAuth metadata (use public URL if behind proxy/ngrok)
  const localUrl = new URL(`http://${host}:${port}`);
  const serverUrl = authConfig.publicUrl ? new URL(authConfig.publicUrl) : localUrl;

  // OAuth metadata and auth middleware setup
  let authMiddleware: ((req: Request, res: Response, next: NextFunction) => void) | null = null;

  if (authConfig.enabled) {
    // Create OAuth metadata
    const oauthMetadata: OAuthMetadata = {
      issuer: serverUrl.toString(),
      authorization_endpoint: `${serverUrl}oauth/authorize`,
      token_endpoint: `${serverUrl}oauth/token`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };

    // Register OAuth metadata routes
    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: serverUrl,
        scopesSupported: ["mcp:tools"],
        resourceName: name,
      })
    );

    // Create token verifier
    const tokenVerifier = createStaticTokenVerifier(
      authConfig.clientId,
      authConfig.clientSecret,
      serverUrl
    );

    // Create auth middleware
    authMiddleware = requireBearerAuth({
      verifier: tokenVerifier,
      requiredScopes: [],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(serverUrl),
    });

    // OAuth authorization endpoint - auto-approves and redirects with code
    app.get("/oauth/authorize", (req: Request, res: Response) => {
      const {
        response_type,
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method,
        state,
      } = req.query as Record<string, string>;

      // Validate required params
      if (response_type !== "code") {
        res.status(400).json({ error: "unsupported_response_type" });
        return;
      }
      if (!redirect_uri || !code_challenge) {
        res.status(400).json({ error: "invalid_request", error_description: "Missing required parameters" });
        return;
      }

      // Generate authorization code
      const code = randomUUID();

      // Store code with PKCE challenge (expires in 10 minutes)
      authCodes.set(code, {
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || "S256",
        redirectUri: redirect_uri,
        clientId: client_id || "unknown",
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      console.log(`[${name}] OAuth authorize: issued code for client ${client_id}`);

      // Redirect back to Claude.ai with the code
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) {
        redirectUrl.searchParams.set("state", state);
      }
      res.redirect(redirectUrl.toString());
    });

    // OAuth token endpoint - exchanges code for access token
    app.post("/oauth/token", (req: Request, res: Response) => {
      console.log(`[${name}] OAuth token request body:`, req.body);
      const { grant_type, code, redirect_uri, code_verifier } = req.body;

      if (grant_type !== "authorization_code") {
        console.log(`[${name}] OAuth token: unsupported grant_type: ${grant_type}`);
        res.status(400).json({ error: "unsupported_grant_type" });
        return;
      }

      // Look up the authorization code
      const authCode = authCodes.get(code);
      if (!authCode) {
        res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired code" });
        return;
      }

      // Check expiration
      if (Date.now() > authCode.expiresAt) {
        authCodes.delete(code);
        res.status(400).json({ error: "invalid_grant", error_description: "Code expired" });
        return;
      }

      // Verify redirect_uri matches
      if (redirect_uri && redirect_uri !== authCode.redirectUri) {
        res.status(400).json({ error: "invalid_grant", error_description: "Redirect URI mismatch" });
        return;
      }

      // Verify PKCE
      if (!code_verifier) {
        console.log(`[${name}] OAuth token: missing code_verifier`);
        res.status(400).json({ error: "invalid_grant", error_description: "Missing code_verifier" });
        return;
      }
      if (!verifyPkce(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
        console.log(`[${name}] OAuth token: PKCE verification failed`);
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }

      // Code is valid - delete it (one-time use)
      authCodes.delete(code);

      console.log(`[${name}] OAuth token: issued access token for client ${authCode.clientId}`);

      // Return the access token (we use the client secret as the token)
      res.json({
        access_token: authConfig.clientSecret,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "mcp:tools",
      });
    });

    console.log(`[${name}] Auth enabled - Client ID: ${authConfig.clientId}`);
    console.log(`[${name}] OAuth metadata at: ${getOAuthProtectedResourceMetadataUrl(serverUrl)}`);
    if (authConfig.publicUrl) {
      console.log(`[${name}] Public URL: ${authConfig.publicUrl}`);
    }
  } else {
    console.log(`[${name}] Warning: No MCP_AUTH_CLIENT_SECRET set - server is open`);
  }

  // Track transports by session ID
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // MCP POST handler
  const mcpPostHandler = async (req: Request, res: Response): Promise<void> => {
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
  };

  // Session request handler (GET/DELETE)
  const handleSessionRequest = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  };

  // Register MCP routes with optional auth
  if (authMiddleware) {
    app.post("/mcp", authMiddleware, mcpPostHandler);
    app.get("/mcp", authMiddleware, handleSessionRequest);
    app.delete("/mcp", authMiddleware, handleSessionRequest);
  } else {
    app.post("/mcp", mcpPostHandler);
    app.get("/mcp", handleSessionRequest);
    app.delete("/mcp", handleSessionRequest);
  }

  // Health check endpoint (no auth required)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      name,
      sessions: Object.keys(transports).length,
      authEnabled: authConfig.enabled,
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

/**
 * Create a gateway server that can host multiple MCP servers on different paths.
 * Shares OAuth authentication across all mounted servers.
 *
 * Usage:
 *   const gateway = await createGatewayServer({ port: 3000 });
 *   gateway.mount("/telegram", telegramServer, "telegram");
 *   gateway.mount("/image-gen", imageGenServer, "image-gen");
 */
export async function createGatewayServer(
  options: GatewayServerOptions
): Promise<GatewayServerResult> {
  const { port, host = "127.0.0.1" } = options;
  const authConfig = getAuthConfig();

  const app = express();

  // Parse both JSON and URL-encoded bodies
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS support
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
      exposedHeaders: ["Mcp-Session-Id"],
    })
  );

  // Request logging
  app.use(createRequestLogger("gateway"));

  // Server URL for OAuth metadata
  const localUrl = new URL(`http://${host}:${port}`);
  const serverUrl = authConfig.publicUrl ? new URL(authConfig.publicUrl) : localUrl;

  // Auth middleware (shared across all mounted servers)
  let authMiddleware: ((req: Request, res: Response, next: NextFunction) => void) | null = null;

  if (authConfig.enabled) {
    // Create OAuth metadata
    const oauthMetadata: OAuthMetadata = {
      issuer: serverUrl.toString(),
      authorization_endpoint: `${serverUrl}oauth/authorize`,
      token_endpoint: `${serverUrl}oauth/token`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };

    // Register OAuth metadata routes
    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: serverUrl,
        scopesSupported: ["mcp:tools"],
        resourceName: "gateway",
      })
    );

    // Create token verifier
    const tokenVerifier = createStaticTokenVerifier(
      authConfig.clientId,
      authConfig.clientSecret,
      serverUrl
    );

    // Create auth middleware
    authMiddleware = requireBearerAuth({
      verifier: tokenVerifier,
      requiredScopes: [],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(serverUrl),
    });

    // OAuth authorization endpoint
    app.get("/oauth/authorize", (req: Request, res: Response) => {
      const {
        response_type,
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method,
        state,
      } = req.query as Record<string, string>;

      if (response_type !== "code") {
        res.status(400).json({ error: "unsupported_response_type" });
        return;
      }
      if (!redirect_uri || !code_challenge) {
        res.status(400).json({ error: "invalid_request", error_description: "Missing required parameters" });
        return;
      }

      const code = randomUUID();
      authCodes.set(code, {
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || "S256",
        redirectUri: redirect_uri,
        clientId: client_id || "unknown",
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      console.log(`[gateway] OAuth authorize: issued code for client ${client_id}`);

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) {
        redirectUrl.searchParams.set("state", state);
      }
      res.redirect(redirectUrl.toString());
    });

    // OAuth token endpoint
    app.post("/oauth/token", (req: Request, res: Response) => {
      const { grant_type, code, redirect_uri, code_verifier } = req.body;

      if (grant_type !== "authorization_code") {
        res.status(400).json({ error: "unsupported_grant_type" });
        return;
      }

      const authCode = authCodes.get(code);
      if (!authCode) {
        res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired code" });
        return;
      }

      if (Date.now() > authCode.expiresAt) {
        authCodes.delete(code);
        res.status(400).json({ error: "invalid_grant", error_description: "Code expired" });
        return;
      }

      if (redirect_uri && redirect_uri !== authCode.redirectUri) {
        res.status(400).json({ error: "invalid_grant", error_description: "Redirect URI mismatch" });
        return;
      }

      if (!code_verifier || !verifyPkce(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }

      authCodes.delete(code);
      console.log(`[gateway] OAuth token: issued access token for client ${authCode.clientId}`);

      res.json({
        access_token: authConfig.clientSecret,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "mcp:tools",
      });
    });

    console.log(`[gateway] Auth enabled - Client ID: ${authConfig.clientId}`);
    console.log(`[gateway] OAuth metadata at: ${getOAuthProtectedResourceMetadataUrl(serverUrl)}`);
    if (authConfig.publicUrl) {
      console.log(`[gateway] Public URL: ${authConfig.publicUrl}`);
    }
  } else {
    console.log(`[gateway] Warning: No MCP_AUTH_CLIENT_SECRET set - server is open`);
  }

  // Track all transports across all mounted servers
  const allTransports: Map<string, { transport: StreamableHTTPServerTransport; serverName: string }> = new Map();

  // Mount function to add MCP servers at different paths
  const mount = (basePath: string, server: Server, name: string) => {
    // Ensure basePath starts with / and doesn't end with /
    const normalizedPath = basePath.startsWith("/") ? basePath : `/${basePath}`;
    const mcpPath = `${normalizedPath}/mcp`;

    const mcpPostHandler = async (req: Request, res: Response): Promise<void> => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      try {
        let transport: StreamableHTTPServerTransport;

        if (sessionId && allTransports.has(sessionId)) {
          transport = allTransports.get(sessionId)!.transport;
        } else if (!sessionId && isInitializeRequest(req.body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              console.log(`[${name}] Session initialized: ${sid}`);
              allTransports.set(sid, { transport, serverName: name });
            },
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && allTransports.has(sid)) {
              console.log(`[${name}] Session closed: ${sid}`);
              allTransports.delete(sid);
            }
          };

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
    };

    const handleSessionRequest = async (req: Request, res: Response): Promise<void> => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !allTransports.has(sessionId)) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }
      const { transport } = allTransports.get(sessionId)!;
      await transport.handleRequest(req, res);
    };

    // Register routes with optional auth
    if (authMiddleware) {
      app.post(mcpPath, authMiddleware, mcpPostHandler);
      app.get(mcpPath, authMiddleware, handleSessionRequest);
      app.delete(mcpPath, authMiddleware, handleSessionRequest);
    } else {
      app.post(mcpPath, mcpPostHandler);
      app.get(mcpPath, handleSessionRequest);
      app.delete(mcpPath, handleSessionRequest);
    }

    console.log(`[gateway] Mounted ${name} at ${mcpPath}`);
  };

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      sessions: allTransports.size,
      authEnabled: authConfig.enabled,
    });
  });

  // Start the server
  const httpServer = app.listen(port, host, () => {
    console.log(`[gateway] MCP Gateway running at http://${host}:${port}`);
  });

  // Shutdown function
  const close = async (): Promise<void> => {
    console.log(`[gateway] Shutting down...`);
    for (const [sessionId, { transport, serverName }] of allTransports) {
      try {
        await transport.close();
        console.log(`[${serverName}] Closed session ${sessionId}`);
      } catch (error) {
        console.error(`[${serverName}] Error closing session ${sessionId}:`, error);
      }
    }
    allTransports.clear();
    return new Promise((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  return { app, mount, close };
}
