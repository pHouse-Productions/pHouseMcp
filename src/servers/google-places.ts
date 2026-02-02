/**
 * Google Places MCP Server - Exportable module
 * Can be imported by the gateway or run standalone via mcp.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Types for Places API responses
interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry?: {
    location: { lat: number; lng: number };
  };
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
  types?: string[];
  opening_hours?: {
    open_now?: boolean;
  };
  price_level?: number;
}

interface PlaceDetails {
  place_id: string;
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  url?: string; // Google Maps URL
  rating?: number;
  user_ratings_total?: number;
  reviews?: Array<{
    author_name: string;
    rating: number;
    text: string;
    time: number;
  }>;
  opening_hours?: {
    open_now?: boolean;
    weekday_text?: string[];
  };
  business_status?: string;
  types?: string[];
  price_level?: number;
}

// Text Search - find places by query string
async function searchPlaces(
  apiKey: string,
  query: string,
  location?: string,
  radius?: number
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    query,
    key: apiKey,
  });

  if (location) {
    params.append("location", location);
  }
  if (radius) {
    params.append("radius", radius.toString());
  }

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Places API error: ${data.status} - ${data.error_message || ""}`);
  }

  return data.results || [];
}

// Nearby Search - find places within radius of a location
async function nearbySearch(
  apiKey: string,
  location: string,
  radius: number,
  type?: string,
  keyword?: string
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    location,
    radius: radius.toString(),
    key: apiKey,
  });

  if (type) {
    params.append("type", type);
  }
  if (keyword) {
    params.append("keyword", keyword);
  }

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Places API error: ${data.status} - ${data.error_message || ""}`);
  }

  return data.results || [];
}

// Get Place Details
async function getPlaceDetails(apiKey: string, placeId: string): Promise<PlaceDetails> {
  const fields = [
    "place_id",
    "name",
    "formatted_address",
    "formatted_phone_number",
    "international_phone_number",
    "website",
    "url",
    "rating",
    "user_ratings_total",
    "reviews",
    "opening_hours",
    "business_status",
    "types",
    "price_level",
  ].join(",");

  const params = new URLSearchParams({
    place_id: placeId,
    fields,
    key: apiKey,
  });

  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK") {
    throw new Error(`Places API error: ${data.status} - ${data.error_message || ""}`);
  }

  return data.result;
}

// Format place result for display
function formatPlaceResult(place: PlaceResult): string {
  const lines = [
    `**${place.name}**`,
    place.formatted_address ? `Address: ${place.formatted_address}` : null,
    place.rating ? `Rating: ${place.rating}/5 (${place.user_ratings_total || 0} reviews)` : null,
    place.business_status ? `Status: ${place.business_status}` : null,
    place.opening_hours?.open_now !== undefined
      ? `Open now: ${place.opening_hours.open_now ? "Yes" : "No"}`
      : null,
    `Place ID: ${place.place_id}`,
  ];

  return lines.filter(Boolean).join("\n");
}

// Format place details for display
function formatPlaceDetails(place: PlaceDetails): string {
  const lines = [
    `**${place.name}**`,
    "",
    place.formatted_address ? `Address: ${place.formatted_address}` : null,
    place.formatted_phone_number ? `Phone: ${place.formatted_phone_number}` : null,
    place.website ? `Website: ${place.website}` : null,
    place.url ? `Google Maps: ${place.url}` : null,
    "",
    place.rating ? `Rating: ${place.rating}/5 (${place.user_ratings_total || 0} reviews)` : null,
    place.business_status ? `Status: ${place.business_status}` : null,
    place.price_level !== undefined ? `Price Level: ${"$".repeat(place.price_level + 1)}` : null,
  ];

  if (place.opening_hours?.weekday_text) {
    lines.push("", "**Hours:**");
    for (const day of place.opening_hours.weekday_text) {
      lines.push(`  ${day}`);
    }
  }

  if (place.reviews && place.reviews.length > 0) {
    lines.push("", "**Recent Reviews:**");
    for (const review of place.reviews.slice(0, 3)) {
      lines.push(`  - ${review.author_name} (${review.rating}/5): "${review.text.slice(0, 150)}${review.text.length > 150 ? "..." : ""}"`);
    }
  }

  lines.push("", `Place ID: ${place.place_id}`);

  return lines.filter((l) => l !== null).join("\n");
}

export interface CreateServerOptions {
  /** Google Places API key (defaults to GOOGLE_PLACES_API_KEY env var) */
  apiKey?: string;
}

/**
 * Create and configure the google-places MCP server.
 */
export async function createServer(options: CreateServerOptions = {}): Promise<Server> {
  const apiKey = options.apiKey || process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY environment variable is required");
  }

  const server = new Server(
    { name: "google-places", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_places",
        description:
          "Search for places using a text query. Great for finding businesses by name or type in a location (e.g., 'auto repair shops in Mississauga').",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "Search query (e.g., 'auto repair shops in Mississauga' or 'pizza near me')",
            },
            location: {
              type: "string",
              description: "Optional center point as 'lat,lng' (e.g., '43.5890,-79.6441' for Mississauga)",
            },
            radius: {
              type: "number",
              description: "Optional search radius in meters (max 50000)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "nearby_search",
        description:
          "Find places within a radius of a specific location. Good for finding all businesses of a type near a point.",
        inputSchema: {
          type: "object" as const,
          properties: {
            location: {
              type: "string",
              description: "Center point as 'lat,lng' (e.g., '43.5890,-79.6441' for Mississauga)",
            },
            radius: {
              type: "number",
              description: "Search radius in meters (max 50000)",
            },
            type: {
              type: "string",
              description: "Place type filter (e.g., 'car_repair', 'restaurant', 'dentist'). See Google Places API types.",
            },
            keyword: {
              type: "string",
              description: "Optional keyword to filter results",
            },
          },
          required: ["location", "radius"],
        },
      },
      {
        name: "get_place_details",
        description:
          "Get detailed information about a specific place including phone, website, hours, and reviews. Requires a place_id from a previous search.",
        inputSchema: {
          type: "object" as const,
          properties: {
            place_id: {
              type: "string",
              description: "The Google Place ID (obtained from search_places or nearby_search)",
            },
          },
          required: ["place_id"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "search_places") {
      const { query, location, radius } = args as {
        query: string;
        location?: string;
        radius?: number;
      };

      try {
        const results = await searchPlaces(apiKey, query, location, radius);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No places found matching your search." }],
          };
        }

        const formatted = results.map(formatPlaceResult).join("\n\n---\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${results.length} places:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to search places: ${errMsg}` }],
          isError: true,
        };
      }
    }

    if (name === "nearby_search") {
      const { location, radius, type, keyword } = args as {
        location: string;
        radius: number;
        type?: string;
        keyword?: string;
      };

      try {
        const results = await nearbySearch(apiKey, location, radius, type, keyword);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No places found in this area." }],
          };
        }

        const formatted = results.map(formatPlaceResult).join("\n\n---\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${results.length} nearby places:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to search nearby: ${errMsg}` }],
          isError: true,
        };
      }
    }

    if (name === "get_place_details") {
      const { place_id } = args as { place_id: string };

      try {
        const details = await getPlaceDetails(apiKey, place_id);
        const formatted = formatPlaceDetails(details);
        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to get place details: ${errMsg}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  return server;
}
