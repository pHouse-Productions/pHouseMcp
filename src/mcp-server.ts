#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as editimage from "../tools/editimage/editimage.js";
import * as genimage from "../tools/genimage/genimage.js";

// Tool registry - add new tools here
const tools = [
  {
    definition: genimage.mcpTool,
    handler: genimage.mcpHandler,
  },
  {
    definition: editimage.mcpTool,
    handler: editimage.mcpHandler,
  },
];

const server = new Server(
  {
    name: "mcp-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((tool) => tool.definition),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.definition.name === request.params.name);

  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  return await tool.handler(request.params.arguments);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Tools server running on stdio");
}

main();
