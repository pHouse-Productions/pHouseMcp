import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runHttpServer } from "@phouse/http-transport";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";

// Parse command line arguments
const args = process.argv.slice(2);
const useHttp = args.includes("--http");
const portIndex = args.indexOf("--port");
const httpPort = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3012;


const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const BASE_URL = "https://finnhub.io/api/v1";

interface StockQuote {
  symbol: string;
  currentPrice: number;
  change: number;
  percentChange: number;
  highPrice: number;
  lowPrice: number;
  openPrice: number;
  previousClose: number;
  timestamp: string;
}

interface CompanyProfile {
  symbol: string;
  name: string;
  country: string;
  currency: string;
  exchange: string;
  ipo: string;
  marketCap: number;
  industry: string;
  logo: string;
  website: string;
  phone: string;
}

interface NewsArticle {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

async function finnhubFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  if (!FINNHUB_API_KEY) {
    throw new Error("FINNHUB_API_KEY environment variable is not set");
  }

  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set("token", FINNHUB_API_KEY);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limited by Finnhub. Please wait a moment and try again.");
    }
    throw new Error(`Finnhub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function getStockQuote(symbol: string): Promise<StockQuote> {
  const data = await finnhubFetch("/quote", { symbol: symbol.toUpperCase() });

  if (!data || data.c === 0) {
    throw new Error(`No data found for symbol: ${symbol}`);
  }

  return {
    symbol: symbol.toUpperCase(),
    currentPrice: data.c,
    change: data.d,
    percentChange: data.dp,
    highPrice: data.h,
    lowPrice: data.l,
    openPrice: data.o,
    previousClose: data.pc,
    timestamp: new Date(data.t * 1000).toISOString(),
  };
}

async function getCompanyProfile(symbol: string): Promise<CompanyProfile> {
  const data = await finnhubFetch("/stock/profile2", { symbol: symbol.toUpperCase() });

  if (!data || !data.name) {
    throw new Error(`No profile data found for symbol: ${symbol}`);
  }

  return {
    symbol: data.ticker,
    name: data.name,
    country: data.country,
    currency: data.currency,
    exchange: data.exchange,
    ipo: data.ipo,
    marketCap: data.marketCapitalization,
    industry: data.finnhubIndustry,
    logo: data.logo,
    website: data.weburl,
    phone: data.phone,
  };
}

async function getCompanyNews(symbol: string, daysBack: number = 7): Promise<NewsArticle[]> {
  const today = new Date();
  const from = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const data = await finnhubFetch("/company-news", {
    symbol: symbol.toUpperCase(),
    from: formatDate(from),
    to: formatDate(today),
  });

  if (!Array.isArray(data)) {
    return [];
  }

  return data.slice(0, 10).map((article: any) => ({
    category: article.category,
    datetime: article.datetime,
    headline: article.headline,
    id: article.id,
    image: article.image,
    related: article.related,
    source: article.source,
    summary: article.summary,
    url: article.url,
  }));
}

async function getMarketNews(category: string = "general"): Promise<NewsArticle[]> {
  const data = await finnhubFetch("/news", { category });

  if (!Array.isArray(data)) {
    return [];
  }

  return data.slice(0, 10).map((article: any) => ({
    category: article.category,
    datetime: article.datetime,
    headline: article.headline,
    id: article.id,
    image: article.image,
    related: article.related,
    source: article.source,
    summary: article.summary,
    url: article.url,
  }));
}

async function searchSymbol(query: string): Promise<Array<{ symbol: string; description: string; type: string }>> {
  const data = await finnhubFetch("/search", { q: query });

  if (!data || !data.result) {
    return [];
  }

  return data.result.slice(0, 10).map((item: any) => ({
    symbol: item.symbol,
    description: item.description,
    type: item.type,
  }));
}

const server = new Server(
  { name: "finnhub", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_stock_quote",
      description:
        "Get the current stock quote including price, change, high/low, and open/previous close. Use stock ticker symbols like AAPL, GOOGL, MSFT, TSLA.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol (e.g., AAPL, GOOGL, MSFT)",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "get_company_profile",
      description:
        "Get company profile including name, industry, market cap, website, and logo URL.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol (e.g., AAPL, GOOGL, MSFT)",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "get_company_news",
      description:
        "Get recent news articles for a specific company. Returns headlines, summaries, and links.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol (e.g., AAPL, GOOGL, MSFT)",
          },
          days_back: {
            type: "number",
            description: "Number of days to look back for news (default: 7, max: 30)",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "get_market_news",
      description:
        "Get general market news. Categories: general, forex, crypto, merger.",
      inputSchema: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            enum: ["general", "forex", "crypto", "merger"],
            description: "News category (default: general)",
          },
        },
        required: [],
      },
    },
    {
      name: "search_symbol",
      description:
        "Search for stock symbols by company name or keyword. Returns matching symbols with descriptions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query - company name or keyword (e.g., 'Apple', 'Tesla', 'bank')",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_stock_quote") {
    const { symbol } = args as { symbol: string };

    try {
      const quote = await getStockQuote(symbol);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(quote, null, 2),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to get quote for ${symbol}: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "get_company_profile") {
    const { symbol } = args as { symbol: string };

    try {
      const profile = await getCompanyProfile(symbol);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(profile, null, 2),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to get profile for ${symbol}: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "get_company_news") {
    const { symbol, days_back = 7 } = args as { symbol: string; days_back?: number };

    try {
      const news = await getCompanyNews(symbol, Math.min(days_back, 30));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                symbol: symbol.toUpperCase(),
                articleCount: news.length,
                articles: news.map((a) => ({
                  headline: a.headline,
                  source: a.source,
                  summary: a.summary,
                  url: a.url,
                  datetime: new Date(a.datetime * 1000).toISOString(),
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to get news for ${symbol}: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "get_market_news") {
    const { category = "general" } = args as { category?: string };

    try {
      const news = await getMarketNews(category);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                category,
                articleCount: news.length,
                articles: news.map((a) => ({
                  headline: a.headline,
                  source: a.source,
                  summary: a.summary,
                  url: a.url,
                  datetime: new Date(a.datetime * 1000).toISOString(),
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to get market news: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "search_symbol") {
    const { query } = args as { query: string };

    try {
      const results = await searchSymbol(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                resultsCount: results.length,
                results,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to search for "${query}": ${errMsg}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  if (useHttp) {
    // HTTP mode - run as persistent server
    console.error(`[MCP] Finnhub server starting in HTTP mode on port ${httpPort}`);
    await runHttpServer(server, { port: httpPort, name: "finnhub" });
  } else {
    // Stdio mode - traditional subprocess
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCP] Finnhub server running (stdio)");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
