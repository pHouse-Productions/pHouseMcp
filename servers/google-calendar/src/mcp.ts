import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getCalendarClient } from "@phouse/google-auth";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

const calendar = getCalendarClient();

// Helper to parse relative dates like "tomorrow", "next monday", etc
function parseDateTime(input: string, defaultTime?: string): Date {
  const now = new Date();
  const lower = input.toLowerCase().trim();

  // Handle relative days
  if (lower === "today") {
    return now;
  }
  if (lower === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (lower.startsWith("next ")) {
    const dayName = lower.slice(5);
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const targetDay = days.indexOf(dayName);
    if (targetDay !== -1) {
      const d = new Date(now);
      const currentDay = d.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      d.setDate(d.getDate() + daysUntil);
      return d;
    }
  }

  // Otherwise try to parse as date
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new Error(`Could not parse date: ${input}`);
}

// Format date for display
function formatDateTime(dateTime: string | undefined, date: string | undefined): string {
  if (dateTime) {
    return new Date(dateTime).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Toronto",
    });
  }
  if (date) {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  return "Unknown";
}

async function listEvents(calendarId: string, maxResults: number, timeMin?: string, timeMax?: string) {
  const params: any = {
    calendarId,
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
    timeMin: timeMin || new Date().toISOString(),
  };

  if (timeMax) {
    params.timeMax = timeMax;
  }

  const response = await calendar.events.list(params);
  const events = response.data.items || [];

  return events.map((event) => ({
    id: event.id,
    summary: event.summary || "(No title)",
    start: formatDateTime(event.start?.dateTime, event.start?.date),
    end: formatDateTime(event.end?.dateTime, event.end?.date),
    location: event.location,
    description: event.description,
    attendees: event.attendees?.map((a) => a.email) || [],
    htmlLink: event.htmlLink,
  }));
}

async function createEvent(
  calendarId: string,
  summary: string,
  startDateTime: string,
  endDateTime: string,
  description?: string,
  location?: string,
  allDay?: boolean,
  attendees?: string[]
) {
  const event: any = {
    summary,
    description,
    location,
  };

  if (allDay) {
    // All-day events use date format (YYYY-MM-DD)
    const startDate = new Date(startDateTime);
    const endDate = new Date(endDateTime);
    event.start = { date: startDate.toISOString().split("T")[0] };
    event.end = { date: endDate.toISOString().split("T")[0] };
  } else {
    event.start = { dateTime: startDateTime, timeZone: "America/Toronto" };
    event.end = { dateTime: endDateTime, timeZone: "America/Toronto" };
  }

  // Add attendees if provided
  if (attendees && attendees.length > 0) {
    event.attendees = attendees.map((email: string) => ({ email }));
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody: event,
    sendUpdates: attendees && attendees.length > 0 ? "all" : "none",
  });

  return {
    id: response.data.id,
    summary: response.data.summary,
    start: formatDateTime(response.data.start?.dateTime, response.data.start?.date),
    end: formatDateTime(response.data.end?.dateTime, response.data.end?.date),
    attendees: response.data.attendees?.map((a) => a.email) || [],
    htmlLink: response.data.htmlLink,
  };
}

async function deleteEvent(calendarId: string, eventId: string) {
  await calendar.events.delete({ calendarId, eventId });
  return { deleted: true, eventId };
}

async function updateEvent(
  calendarId: string,
  eventId: string,
  updates: { summary?: string; description?: string; location?: string; startDateTime?: string; endDateTime?: string; attendees?: string[] }
) {
  // Get existing event first
  const existing = await calendar.events.get({ calendarId, eventId });

  const event: any = {
    summary: updates.summary || existing.data.summary,
    description: updates.description !== undefined ? updates.description : existing.data.description,
    location: updates.location !== undefined ? updates.location : existing.data.location,
  };

  if (updates.startDateTime) {
    event.start = { dateTime: updates.startDateTime, timeZone: "America/Toronto" };
  } else {
    event.start = existing.data.start;
  }

  if (updates.endDateTime) {
    event.end = { dateTime: updates.endDateTime, timeZone: "America/Toronto" };
  } else {
    event.end = existing.data.end;
  }

  // Handle attendees - merge with existing or replace
  if (updates.attendees !== undefined) {
    event.attendees = updates.attendees.map((email: string) => ({ email }));
  } else {
    event.attendees = existing.data.attendees;
  }

  const hasNewAttendees = updates.attendees && updates.attendees.length > 0;

  const response = await calendar.events.update({
    calendarId,
    eventId,
    requestBody: event,
    sendUpdates: hasNewAttendees ? "all" : "none",
  });

  return {
    id: response.data.id,
    summary: response.data.summary,
    start: formatDateTime(response.data.start?.dateTime, response.data.start?.date),
    end: formatDateTime(response.data.end?.dateTime, response.data.end?.date),
    attendees: response.data.attendees?.map((a) => a.email) || [],
    htmlLink: response.data.htmlLink,
  };
}

async function listCalendars() {
  const response = await calendar.calendarList.list();
  return (response.data.items || []).map((cal) => ({
    id: cal.id,
    summary: cal.summary,
    primary: cal.primary || false,
    accessRole: cal.accessRole,
  }));
}

const server = new Server(
  { name: "google-calendar", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_events",
      description: "List upcoming events from a Google Calendar. Returns event summaries, times, and links.",
      inputSchema: {
        type: "object" as const,
        properties: {
          calendar_id: { type: "string", description: "Calendar ID (default: 'primary' for user's main calendar)" },
          max_results: { type: "number", description: "Maximum number of events to return (default: 10)" },
          time_min: { type: "string", description: "Start of time range in ISO format (default: now)" },
          time_max: { type: "string", description: "End of time range in ISO format (optional)" },
        },
        required: [],
      },
    },
    {
      name: "create_event",
      description: "Create a new event on Google Calendar.",
      inputSchema: {
        type: "object" as const,
        properties: {
          summary: { type: "string", description: "Event title" },
          start: { type: "string", description: "Start date/time in ISO format (e.g., '2026-01-28T14:00:00')" },
          end: { type: "string", description: "End date/time in ISO format (e.g., '2026-01-28T15:00:00')" },
          description: { type: "string", description: "Event description (optional)" },
          location: { type: "string", description: "Event location (optional)" },
          calendar_id: { type: "string", description: "Calendar ID (default: 'primary')" },
          all_day: { type: "boolean", description: "Create as all-day event (default: false)" },
          attendees: { type: "array", items: { type: "string" }, description: "Email addresses of attendees to invite (optional)" },
        },
        required: ["summary", "start", "end"],
      },
    },
    {
      name: "delete_event",
      description: "Delete an event from Google Calendar.",
      inputSchema: {
        type: "object" as const,
        properties: {
          event_id: { type: "string", description: "The event ID to delete" },
          calendar_id: { type: "string", description: "Calendar ID (default: 'primary')" },
        },
        required: ["event_id"],
      },
    },
    {
      name: "update_event",
      description: "Update an existing event on Google Calendar. Only provide fields you want to change.",
      inputSchema: {
        type: "object" as const,
        properties: {
          event_id: { type: "string", description: "The event ID to update" },
          calendar_id: { type: "string", description: "Calendar ID (default: 'primary')" },
          summary: { type: "string", description: "New event title" },
          description: { type: "string", description: "New event description" },
          location: { type: "string", description: "New event location" },
          start: { type: "string", description: "New start date/time in ISO format" },
          end: { type: "string", description: "New end date/time in ISO format" },
          attendees: { type: "array", items: { type: "string" }, description: "Email addresses of attendees to invite" },
        },
        required: ["event_id"],
      },
    },
    {
      name: "list_calendars",
      description: "List all calendars accessible by the user.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_events") {
    const { calendar_id = "primary", max_results = 10, time_min, time_max } = (args as any) || {};
    try {
      const events = await listEvents(calendar_id, max_results, time_min, time_max);
      if (events.length === 0) {
        return { content: [{ type: "text", text: "No upcoming events found." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to list events: ${error}` }], isError: true };
    }
  }

  if (name === "create_event") {
    const { summary, start, end, description, location, calendar_id = "primary", all_day = false, attendees } = args as any;
    try {
      const event = await createEvent(calendar_id, summary, start, end, description, location, all_day, attendees);
      return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to create event: ${error}` }], isError: true };
    }
  }

  if (name === "delete_event") {
    const { event_id, calendar_id = "primary" } = args as any;
    try {
      const result = await deleteEvent(calendar_id, event_id);
      return { content: [{ type: "text", text: `Event deleted successfully.` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to delete event: ${error}` }], isError: true };
    }
  }

  if (name === "update_event") {
    const { event_id, calendar_id = "primary", summary, description, location, start, end, attendees } = args as any;
    try {
      const event = await updateEvent(calendar_id, event_id, {
        summary,
        description,
        location,
        startDateTime: start,
        endDateTime: end,
        attendees,
      });
      return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update event: ${error}` }], isError: true };
    }
  }

  if (name === "list_calendars") {
    try {
      const calendars = await listCalendars();
      return { content: [{ type: "text", text: JSON.stringify(calendars, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to list calendars: ${error}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Google Calendar server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
