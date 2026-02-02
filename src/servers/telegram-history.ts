import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// History stored in pHouseMcp/data/telegram/ by default
// Can be overridden via PHOUSE_DATA_DIR env var
const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../../data");
const DATA_DIR = process.env.PHOUSE_DATA_DIR || DEFAULT_DATA_DIR;
const HISTORY_DIR = path.join(DATA_DIR, "telegram");

export interface Message {
  role: "user" | "assistant";
  name?: string;
  text: string;
  timestamp: string;
}

function getHistoryPath(chatId: number): string {
  return path.join(HISTORY_DIR, `${chatId}.json`);
}

export function loadHistory(chatId: number): Message[] {
  const filePath = getHistoryPath(chatId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function saveMessage(chatId: number, message: Message): void {
  // Ensure directory exists
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }

  const history = loadHistory(chatId);
  history.push(message);
  fs.writeFileSync(getHistoryPath(chatId), JSON.stringify(history, null, 2));
}

export function getRecentMessages(chatId: number, n: number): Message[] {
  const history = loadHistory(chatId);
  return history.slice(-n);
}
