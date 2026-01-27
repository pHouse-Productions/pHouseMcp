import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");
const LEADS_TRACKER = path.join(PROJECT_ROOT, "leads/tracker.json");

// Ensure notes directory exists
if (!fs.existsSync(NOTES_DIR)) {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
}

// Note categories with their file mappings
const CATEGORIES: Record<string, string> = {
  journal: "journal.md",
  projects: "projects.md",
  people: "people.md",
  scratch: "scratch.md",
};

function getNotePath(category: string): string {
  const filename = CATEGORIES[category] || `${category}.md`;
  return path.join(NOTES_DIR, filename);
}

function getTorontoTimestamp(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getTorontoDate(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
  });
}

function readNote(category: string): string {
  const notePath = getNotePath(category);
  if (fs.existsSync(notePath)) {
    return fs.readFileSync(notePath, "utf-8");
  }
  return "";
}

function appendToNote(category: string, content: string): void {
  const notePath = getNotePath(category);
  let existing = "";
  if (fs.existsSync(notePath)) {
    existing = fs.readFileSync(notePath, "utf-8");
  }
  fs.writeFileSync(notePath, existing + content);
}

function writeNote(category: string, content: string): void {
  const notePath = getNotePath(category);
  fs.writeFileSync(notePath, content);
}

// Search across all notes
function searchNotes(query: string): Array<{ category: string; matches: string[] }> {
  const results: Array<{ category: string; matches: string[] }> = [];
  const queryLower = query.toLowerCase();

  for (const [category, filename] of Object.entries(CATEGORIES)) {
    const notePath = path.join(NOTES_DIR, filename);
    if (fs.existsSync(notePath)) {
      const content = fs.readFileSync(notePath, "utf-8");
      const lines = content.split("\n");
      const matches: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          // Include context (line before and after)
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length - 1, i + 1);
          const context = lines.slice(start, end + 1).join("\n");
          matches.push(`Line ${i + 1}:\n${context}`);
        }
      }

      if (matches.length > 0) {
        results.push({ category, matches });
      }
    }
  }

  // Also search leads tracker
  if (fs.existsSync(LEADS_TRACKER)) {
    const tracker = JSON.parse(fs.readFileSync(LEADS_TRACKER, "utf-8"));
    const matches: string[] = [];

    for (const lead of tracker.evaluated || []) {
      const leadStr = JSON.stringify(lead).toLowerCase();
      if (leadStr.includes(queryLower)) {
        matches.push(`${lead.name} (${lead.status}): ${lead.reason?.substring(0, 100)}...`);
      }
    }

    if (matches.length > 0) {
      results.push({ category: "leads", matches });
    }
  }

  return results;
}

// Load leads tracker
function loadLeads(): any {
  if (fs.existsSync(LEADS_TRACKER)) {
    return JSON.parse(fs.readFileSync(LEADS_TRACKER, "utf-8"));
  }
  return { evaluated: [] };
}

// Save leads tracker
function saveLeads(data: any): void {
  const dir = path.dirname(LEADS_TRACKER);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(LEADS_TRACKER, JSON.stringify(data, null, 2));
}

const server = new Server(
  { name: "memory", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "recall",
      description:
        "Recall memories from a specific category or search across all notes. Use this at the START of sessions to get context. Categories: journal (activity log), projects (active work), people (contacts), scratch (working memory), leads (business tracker).",
      inputSchema: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            description:
              "Category to recall from: journal, projects, people, scratch, leads. If omitted, returns a summary of all categories.",
            enum: ["journal", "projects", "people", "scratch", "leads"],
          },
          query: {
            type: "string",
            description:
              "Optional search query to filter results. Searches content within the category (or all categories if none specified).",
          },
        },
        required: [],
      },
    },
    {
      name: "remember",
      description:
        "Save information to memory. Use this to persist context between sessions. For journal entries, content is auto-timestamped and appended. For other categories, you can append or replace.",
      inputSchema: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            description: "Category to save to: journal, projects, people, scratch",
            enum: ["journal", "projects", "people", "scratch"],
          },
          content: {
            type: "string",
            description: "The content to remember. For journal, this should be a bullet point or short note. For projects/people, can be structured markdown.",
          },
          mode: {
            type: "string",
            description: "How to save: 'append' adds to existing content (default), 'replace' overwrites the entire note. Use replace carefully!",
            enum: ["append", "replace"],
          },
        },
        required: ["category", "content"],
      },
    },
    {
      name: "log_activity",
      description:
        "Quick way to log an activity to the journal. Automatically adds timestamp and formats as bullet point. Use this throughout sessions to track what you've done.",
      inputSchema: {
        type: "object" as const,
        properties: {
          activity: {
            type: "string",
            description: "What happened or was accomplished. Keep it concise.",
          },
          section: {
            type: "string",
            description: "Optional section header (e.g., 'Email Security' or 'Lead Finding'). If the current date already has this section, appends to it. Otherwise creates new section.",
          },
        },
        required: ["activity"],
      },
    },
    {
      name: "update_lead",
      description:
        "Update a lead in the tracker. Can update status, add notes, or modify any field.",
      inputSchema: {
        type: "object" as const,
        properties: {
          slug: {
            type: "string",
            description: "The lead slug (e.g., 'irenes-celebrity-cakes')",
          },
          updates: {
            type: "object",
            description: "Fields to update. Can include: status, notes, website, repo, preview, contact, etc.",
          },
        },
        required: ["slug", "updates"],
      },
    },
    {
      name: "add_lead",
      description: "Add a new lead to the tracker.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Business name",
          },
          slug: {
            type: "string",
            description: "URL-friendly slug (lowercase, hyphens)",
          },
          industry: {
            type: "string",
            description: "Business industry/type",
          },
          reason: {
            type: "string",
            description: "Why they need a new website",
          },
          website: {
            type: "string",
            description: "Current website URL (null if none)",
          },
          contact: {
            type: "object",
            description: "Contact info: phone, email, address, hours",
          },
          notes: {
            type: "string",
            description: "Additional notes about the business",
          },
        },
        required: ["name", "slug", "reason"],
      },
    },
    {
      name: "search_memory",
      description:
        "Search across all memory (notes and leads) for a query. Returns matching lines with context.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "recall") {
    const { category, query } = args as { category?: string; query?: string };

    // If query provided, search
    if (query) {
      const results = searchNotes(query);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No results found for "${query}"` }],
        };
      }

      const formatted = results
        .map((r) => `### ${r.category}\n${r.matches.join("\n\n")}`)
        .join("\n\n");

      return {
        content: [{ type: "text", text: `Search results for "${query}":\n\n${formatted}` }],
      };
    }

    // If category specified, return that note
    if (category) {
      if (category === "leads") {
        const leads = loadLeads();
        const summary = (leads.evaluated || [])
          .map((l: any) => `- ${l.name} [${l.status}]: ${l.reason?.substring(0, 80)}...`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Leads Tracker:\n\n${summary}` }],
        };
      }

      const content = readNote(category);
      if (!content) {
        return {
          content: [{ type: "text", text: `No content in ${category}` }],
        };
      }
      return {
        content: [{ type: "text", text: `## ${category}\n\n${content}` }],
      };
    }

    // No category - return summary of all
    const summaries: string[] = [];
    for (const [cat, filename] of Object.entries(CATEGORIES)) {
      const content = readNote(cat);
      if (content) {
        const lines = content.split("\n").filter((l) => l.trim());
        const preview = lines.slice(0, 5).join("\n");
        summaries.push(`### ${cat} (${lines.length} lines)\n${preview}\n...`);
      }
    }

    // Add leads summary
    const leads = loadLeads();
    const leadCount = (leads.evaluated || []).length;
    summaries.push(`### leads (${leadCount} businesses tracked)`);

    return {
      content: [{ type: "text", text: `Memory Summary:\n\n${summaries.join("\n\n")}` }],
    };
  }

  if (name === "remember") {
    const { category, content, mode = "append" } = args as {
      category: string;
      content: string;
      mode?: string;
    };

    if (mode === "replace") {
      writeNote(category, content);
      return {
        content: [{ type: "text", text: `Replaced content in ${category}` }],
      };
    }

    // Append mode
    const existing = readNote(category);
    const separator = existing.endsWith("\n") ? "" : "\n";
    appendToNote(category, separator + content);

    return {
      content: [{ type: "text", text: `Appended to ${category}` }],
    };
  }

  if (name === "log_activity") {
    const { activity, section } = args as { activity: string; section?: string };
    const today = getTorontoDate();
    const timestamp = getTorontoTimestamp();

    let journal = readNote("journal");

    // Check if today's date header exists
    const dateHeader = `## ${today}`;
    const hasToday = journal.includes(dateHeader);

    if (!hasToday) {
      // Add new date section at the top (after the main header if present)
      const lines = journal.split("\n");
      let insertIndex = 0;

      // Find where to insert (after # Journal header)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("# ")) {
          insertIndex = i + 1;
          break;
        }
      }

      const newSection = section
        ? `${dateHeader}\n### ${section}\n- ${activity}\n`
        : `${dateHeader}\n- ${activity}\n`;

      lines.splice(insertIndex, 0, "", newSection);
      writeNote("journal", lines.join("\n"));
    } else {
      // Today exists, find where to add
      const lines = journal.split("\n");
      const todayIndex = lines.findIndex((l) => l.includes(dateHeader));

      if (section) {
        const sectionHeader = `### ${section}`;
        const sectionIndex = lines.findIndex(
          (l, i) => i > todayIndex && l.includes(sectionHeader)
        );

        if (sectionIndex !== -1) {
          // Section exists, find end of section (next ### or ##)
          let insertAt = sectionIndex + 1;
          for (let i = sectionIndex + 1; i < lines.length; i++) {
            if (lines[i].startsWith("##")) {
              insertAt = i;
              break;
            }
            insertAt = i + 1;
          }
          lines.splice(insertAt, 0, `- ${activity}`);
        } else {
          // Section doesn't exist, add it after date header
          lines.splice(todayIndex + 1, 0, `### ${section}`, `- ${activity}`);
        }
      } else {
        // No section, just add after date header
        lines.splice(todayIndex + 1, 0, `- ${activity}`);
      }

      writeNote("journal", lines.join("\n"));
    }

    return {
      content: [{ type: "text", text: `Logged: ${activity}` }],
    };
  }

  if (name === "update_lead") {
    const { slug, updates } = args as { slug: string; updates: Record<string, any> };

    const leads = loadLeads();
    const leadIndex = (leads.evaluated || []).findIndex(
      (l: any) => l.slug === slug
    );

    if (leadIndex === -1) {
      return {
        content: [{ type: "text", text: `Lead not found: ${slug}` }],
        isError: true,
      };
    }

    leads.evaluated[leadIndex] = {
      ...leads.evaluated[leadIndex],
      ...updates,
    };

    saveLeads(leads);

    return {
      content: [
        {
          type: "text",
          text: `Updated lead "${slug}": ${JSON.stringify(updates)}`,
        },
      ],
    };
  }

  if (name === "add_lead") {
    const { name: bizName, slug, industry, reason, website, contact, notes } = args as {
      name: string;
      slug: string;
      industry?: string;
      reason: string;
      website?: string;
      contact?: Record<string, string>;
      notes?: string;
    };

    const leads = loadLeads();

    // Check if slug already exists
    const exists = (leads.evaluated || []).some((l: any) => l.slug === slug);
    if (exists) {
      return {
        content: [{ type: "text", text: `Lead with slug "${slug}" already exists` }],
        isError: true,
      };
    }

    const newLead = {
      name: bizName,
      slug,
      date: getTorontoDate(),
      status: "lead",
      industry,
      reason,
      website: website || null,
      contact,
      notes,
    };

    leads.evaluated = leads.evaluated || [];
    leads.evaluated.push(newLead);
    saveLeads(leads);

    return {
      content: [{ type: "text", text: `Added lead: ${bizName}` }],
    };
  }

  if (name === "search_memory") {
    const { query } = args as { query: string };

    const results = searchNotes(query);

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No results found for "${query}"` }],
      };
    }

    const formatted = results
      .map((r) => `### ${r.category}\n${r.matches.join("\n\n")}`)
      .join("\n\n");

    return {
      content: [{ type: "text", text: `Search results for "${query}":\n\n${formatted}` }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Memory MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
