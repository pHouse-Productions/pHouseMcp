import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// History stored in pHouseMcp/data/discord/ by default
// Can be overridden via PHOUSE_DATA_DIR env var
const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../../data");
const DATA_DIR = process.env.PHOUSE_DATA_DIR || DEFAULT_DATA_DIR;
const HISTORY_DIR = path.join(DATA_DIR, "discord");

export interface Message {
  role: "user" | "assistant";
  name?: string;
  text: string;
  timestamp: string;
}

function getHistoryPath(channelId: string): string {
  return path.join(HISTORY_DIR, `${channelId}.json`);
}

export function loadHistory(channelId: string): Message[] {
  const filePath = getHistoryPath(channelId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function saveMessage(channelId: string, message: Message): void {
  // Ensure directory exists
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }

  const history = loadHistory(channelId);
  history.push(message);
  fs.writeFileSync(getHistoryPath(channelId), JSON.stringify(history, null, 2));
}

export function getRecentMessages(channelId: string, n: number): Message[] {
  const history = loadHistory(channelId);
  return history.slice(-n);
}
