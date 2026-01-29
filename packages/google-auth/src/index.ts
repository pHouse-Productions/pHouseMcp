import { google, Auth } from "googleapis";
import * as fs from "fs";
import * as path from "path";

let oauth2Client: Auth.OAuth2Client | null = null;

/**
 * Get or create the OAuth2 client for Google APIs.
 * Uses environment variables for credentials paths:
 * - GOOGLE_CREDENTIALS_PATH: path to client_secret.json
 * - GOOGLE_TOKEN_PATH: path to tokens.json
 *
 * Falls back to ~/.config/phouse/ if env vars not set.
 */
export function getOAuth2Client(): Auth.OAuth2Client {
  if (oauth2Client) {
    return oauth2Client;
  }

  const configDir = path.join(process.env.HOME || "/home/ubuntu", ".config", "phouse");
  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || path.join(configDir, "google_credentials.json");
  const tokenPath = process.env.GOOGLE_TOKEN_PATH || path.join(configDir, "google_token.json");

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Google credentials not found at ${credentialsPath}. Set GOOGLE_CREDENTIALS_PATH or place file in ~/.config/phouse/`);
  }

  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Google token not found at ${tokenPath}. Set GOOGLE_TOKEN_PATH or place file in ~/.config/phouse/`);
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
  const { client_id, client_secret } = credentials.installed || credentials.web || {};

  if (!client_id || !client_secret) {
    throw new Error("Invalid credentials file format - missing client_id or client_secret");
  }

  // Get redirect URI from credentials or use default
  const redirectUri = credentials.web?.redirect_uris?.[1] || credentials.installed?.redirect_uris?.[0] || "http://localhost:3000";

  oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirectUri
  );

  const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
  oauth2Client.setCredentials(tokens);

  // Auto-refresh tokens when they expire
  oauth2Client.on("tokens", (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    const updatedTokens = { ...currentTokens, ...newTokens };
    fs.writeFileSync(tokenPath, JSON.stringify(updatedTokens, null, 2));
    fs.chmodSync(tokenPath, 0o600);
  });

  return oauth2Client;
}

/**
 * Get authenticated Google Drive client
 */
export function getDriveClient() {
  return google.drive({ version: "v3", auth: getOAuth2Client() });
}

/**
 * Get authenticated Google Sheets client
 */
export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getOAuth2Client() });
}

/**
 * Get authenticated Google Docs client
 */
export function getDocsClient() {
  return google.docs({ version: "v1", auth: getOAuth2Client() });
}

/**
 * Get authenticated Gmail client
 */
export function getGmailClient() {
  return google.gmail({ version: "v1", auth: getOAuth2Client() });
}

/**
 * Get authenticated Google Calendar client
 */
export function getCalendarClient() {
  return google.calendar({ version: "v3", auth: getOAuth2Client() });
}
