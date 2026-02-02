/**
 * Cron MCP Server - Exportable module
 * Can be imported by the gateway or run standalone via mcp.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

// Cron job interface
interface CronJob {
  id: string;
  enabled: boolean;
  schedule: string;
  description: string;
  prompt: string;
  created_at: string;
  updated_at: string;
  run_once?: boolean;        // If true, delete after first run
  run_at?: string;           // ISO timestamp for one-off delayed tasks
}

interface CronConfig {
  jobs: CronJob[];
}

function loadConfig(configFile: string): CronConfig {
  try {
    if (fs.existsSync(configFile)) {
      const content = fs.readFileSync(configFile, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error loading config: ${err}`);
  }
  return { jobs: [] };
}

function saveConfig(configFile: string, config: CronConfig): void {
  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

// Get current time in Toronto timezone
function getTorontoNow(): Date {
  const torontoTime = new Date().toLocaleString("en-US", { timeZone: "America/Toronto" });
  return new Date(torontoTime);
}

// Parse delay strings like "in 5 minutes", "in 1 hour", "at 3pm", "at 15:30"
// All times are interpreted as Toronto time
function parseDelay(delay: string): Date | null {
  const now = new Date();
  const torontoNow = getTorontoNow();
  const lower = delay.toLowerCase().trim();

  // "in X minutes/hours/seconds" - relative delays work the same regardless of timezone
  const inMatch = lower.match(/^in\s+(\d+)\s+(second|minute|hour|day)s?$/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const ms = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
    }[unit] || 60 * 1000;
    return new Date(now.getTime() + amount * ms);
  }

  // "at Xam/pm" or "at HH:MM" - interpret as Toronto time
  const atMatch = lower.match(/^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (atMatch) {
    let hour = parseInt(atMatch[1]);
    const minute = atMatch[2] ? parseInt(atMatch[2]) : 0;
    const ampm = atMatch[3];

    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    // Build target time in Toronto
    const torontoTarget = new Date(torontoNow);
    torontoTarget.setHours(hour, minute, 0, 0);

    // If time has passed today in Toronto, schedule for tomorrow
    if (torontoTarget <= torontoNow) {
      torontoTarget.setDate(torontoTarget.getDate() + 1);
    }

    // Calculate the offset from now to the Toronto target time
    const msUntilTarget = torontoTarget.getTime() - torontoNow.getTime();
    return new Date(now.getTime() + msUntilTarget);
  }

  return null;
}

export interface CreateServerOptions {
  /** Path to the cron config file (defaults to ~/.config/phouse/cron.json) */
  configFile?: string;
}

/**
 * Create and configure the cron MCP server.
 */
export async function createServer(options: CreateServerOptions = {}): Promise<Server> {
  // Config file location: use option, env var, or default to ~/.config/phouse/cron.json
  const configDir = path.join(process.env.HOME || "", ".config", "phouse");
  const configFile = options.configFile || process.env.CRON_CONFIG_FILE || path.join(configDir, "cron.json");

  const server = new Server(
    { name: "cron", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_jobs",
        description: "List all scheduled cron jobs",
        inputSchema: {
          type: "object" as const,
          properties: {
            include_disabled: {
              type: "boolean",
              description: "Include disabled jobs in the list (default: true)",
            },
          },
          required: [],
        },
      },
      {
        name: "create_job",
        description: "Create a new scheduled cron job. Schedule can be human-readable (e.g., 'every hour', 'daily at 9am', 'every 30 minutes') or cron syntax (e.g., '0 9 * * *'). The prompt can be as detailed as needed - multiple paragraphs of instructions are supported.",
        inputSchema: {
          type: "object" as const,
          properties: {
            schedule: {
              type: "string",
              description: "When to run the job. Supports: 'every minute', 'every X minutes', 'every hour', 'every X hours', 'daily', 'daily at Xam/pm', 'weekly', or cron syntax like '0 9 * * *'",
            },
            description: {
              type: "string",
              description: "Short description of what this job does (shown in job list)",
            },
            prompt: {
              type: "string",
              description: "The full instructions for what to do when this job runs. Can be detailed multi-paragraph instructions.",
            },
            enabled: {
              type: "boolean",
              description: "Whether the job should be enabled immediately (default: true)",
            },
          },
          required: ["schedule", "description", "prompt"],
        },
      },
      {
        name: "edit_job",
        description: "Edit an existing cron job. Only provide the fields you want to change.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "The job ID to edit",
            },
            schedule: {
              type: "string",
              description: "New schedule for the job",
            },
            description: {
              type: "string",
              description: "New description for the job",
            },
            prompt: {
              type: "string",
              description: "New prompt/instructions for the job",
            },
            enabled: {
              type: "boolean",
              description: "Enable or disable the job",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "delete_job",
        description: "Delete a scheduled cron job",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "The job ID to delete",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "toggle_job",
        description: "Enable or disable a cron job without deleting it",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "The job ID to toggle",
            },
            enabled: {
              type: "boolean",
              description: "Set to true to enable, false to disable",
            },
          },
          required: ["id", "enabled"],
        },
      },
      {
        name: "get_job",
        description: "Get detailed information about a specific job including its full prompt",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "The job ID to retrieve",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "schedule_once",
        description: "Schedule a one-off task to run at a specific time or after a delay. The task will automatically be deleted after it runs.",
        inputSchema: {
          type: "object" as const,
          properties: {
            delay: {
              type: "string",
              description: "When to run. Supports: 'in 5 minutes', 'in 1 hour', 'in 30 seconds', 'at 3pm', 'at 15:30'",
            },
            description: {
              type: "string",
              description: "Short description of what this task does",
            },
            prompt: {
              type: "string",
              description: "The full instructions for what to do when this task runs",
            },
          },
          required: ["delay", "description", "prompt"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "list_jobs") {
      const { include_disabled = true } = args as { include_disabled?: boolean };
      const config = loadConfig(configFile);

      let jobs = config.jobs;
      if (!include_disabled) {
        jobs = jobs.filter((j) => j.enabled);
      }

      if (jobs.length === 0) {
        return {
          content: [{ type: "text", text: "No scheduled jobs found." }],
        };
      }

      const jobList = jobs.map((job) => {
        const status = job.enabled ? "\u2713 enabled" : "\u2717 disabled";
        return `\u2022 ${job.id}\n  Schedule: ${job.schedule}\n  Description: ${job.description}\n  Status: ${status}`;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `Scheduled Jobs:\n\n${jobList}` }],
      };
    }

    if (name === "create_job") {
      const { schedule, description, prompt, enabled = true } = args as {
        schedule: string;
        description: string;
        prompt: string;
        enabled?: boolean;
      };

      const config = loadConfig(configFile);
      const now = new Date().toISOString();

      const newJob: CronJob = {
        id: randomUUID().slice(0, 8),
        enabled,
        schedule,
        description,
        prompt,
        created_at: now,
        updated_at: now,
      };

      config.jobs.push(newJob);
      saveConfig(configFile, config);

      return {
        content: [
          {
            type: "text",
            text: `Created job "${newJob.id}":\n\u2022 Schedule: ${schedule}\n\u2022 Description: ${description}\n\u2022 Status: ${enabled ? "enabled" : "disabled"}\n\nThe watcher will automatically pick up this new job.`,
          },
        ],
      };
    }

    if (name === "edit_job") {
      const { id, schedule, description, prompt, enabled } = args as {
        id: string;
        schedule?: string;
        description?: string;
        prompt?: string;
        enabled?: boolean;
      };

      const config = loadConfig(configFile);
      const jobIndex = config.jobs.findIndex((j) => j.id === id);

      if (jobIndex === -1) {
        return {
          content: [{ type: "text", text: `Job not found: ${id}` }],
          isError: true,
        };
      }

      const job = config.jobs[jobIndex];

      if (schedule !== undefined) job.schedule = schedule;
      if (description !== undefined) job.description = description;
      if (prompt !== undefined) job.prompt = prompt;
      if (enabled !== undefined) job.enabled = enabled;
      job.updated_at = new Date().toISOString();

      saveConfig(configFile, config);

      return {
        content: [
          {
            type: "text",
            text: `Updated job "${id}":\n\u2022 Schedule: ${job.schedule}\n\u2022 Description: ${job.description}\n\u2022 Status: ${job.enabled ? "enabled" : "disabled"}`,
          },
        ],
      };
    }

    if (name === "delete_job") {
      const { id } = args as { id: string };

      const config = loadConfig(configFile);
      const jobIndex = config.jobs.findIndex((j) => j.id === id);

      if (jobIndex === -1) {
        return {
          content: [{ type: "text", text: `Job not found: ${id}` }],
          isError: true,
        };
      }

      const deleted = config.jobs.splice(jobIndex, 1)[0];
      saveConfig(configFile, config);

      return {
        content: [
          {
            type: "text",
            text: `Deleted job "${id}" (${deleted.description})`,
          },
        ],
      };
    }

    if (name === "toggle_job") {
      const { id, enabled } = args as { id: string; enabled: boolean };

      const config = loadConfig(configFile);
      const job = config.jobs.find((j) => j.id === id);

      if (!job) {
        return {
          content: [{ type: "text", text: `Job not found: ${id}` }],
          isError: true,
        };
      }

      job.enabled = enabled;
      job.updated_at = new Date().toISOString();
      saveConfig(configFile, config);

      return {
        content: [
          {
            type: "text",
            text: `Job "${id}" is now ${enabled ? "enabled" : "disabled"}`,
          },
        ],
      };
    }

    if (name === "get_job") {
      const { id } = args as { id: string };

      const config = loadConfig(configFile);
      const job = config.jobs.find((j) => j.id === id);

      if (!job) {
        return {
          content: [{ type: "text", text: `Job not found: ${id}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Job: ${job.id}\n\nSchedule: ${job.schedule}\nDescription: ${job.description}\nStatus: ${job.enabled ? "enabled" : "disabled"}\nCreated: ${job.created_at}\nUpdated: ${job.updated_at}\n\nPrompt:\n${job.prompt}`,
          },
        ],
      };
    }

    if (name === "schedule_once") {
      const { delay, description, prompt } = args as {
        delay: string;
        description: string;
        prompt: string;
      };

      const runAt = parseDelay(delay);
      if (!runAt) {
        return {
          content: [{ type: "text", text: `Could not parse delay: "${delay}". Try formats like "in 5 minutes", "in 1 hour", "at 3pm", "at 15:30"` }],
          isError: true,
        };
      }

      const config = loadConfig(configFile);
      const now = new Date().toISOString();

      // Format the time nicely in Toronto timezone
      const torontoTimeStr = runAt.toLocaleString("en-US", {
        timeZone: "America/Toronto",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const newJob: CronJob = {
        id: randomUUID().slice(0, 8),
        enabled: true,
        schedule: `once at ${torontoTimeStr} ET`,
        description,
        prompt,
        created_at: now,
        updated_at: now,
        run_once: true,
        run_at: runAt.toISOString(),
      };

      config.jobs.push(newJob);
      saveConfig(configFile, config);

      // Calculate human-readable time until
      const diffMs = runAt.getTime() - Date.now();
      const diffMins = Math.round(diffMs / 60000);
      const timeStr = diffMins < 60
        ? `${diffMins} minute${diffMins !== 1 ? 's' : ''}`
        : `${Math.round(diffMins / 60)} hour${Math.round(diffMins / 60) !== 1 ? 's' : ''}`;

      return {
        content: [
          {
            type: "text",
            text: `Scheduled one-off task "${newJob.id}":\n\u2022 Runs in: ${timeStr} (${torontoTimeStr} ET)\n\u2022 Description: ${description}\n\nThis task will auto-delete after it runs.`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  return server;
}
