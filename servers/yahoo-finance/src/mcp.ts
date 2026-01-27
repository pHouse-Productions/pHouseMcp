import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

interface StockQuote {
  symbol: string;
  shortName: string | null;
  regularMarketPrice: number | null;
  regularMarketChange: number | null;
  regularMarketChangePercent: number | null;
  regularMarketVolume: number | null;
  regularMarketOpen: number | null;
  regularMarketDayHigh: number | null;
  regularMarketDayLow: number | null;
  regularMarketPreviousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketCap: number | null;
  currency: string | null;
  exchange: string | null;
}

interface HistoricalData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

interface CompanyProfile {
  symbol: string;
  shortName: string | null;
  longName: string | null;
  industry: string | null;
  sector: string | null;
  website: string | null;
  longBusinessSummary: string | null;
  fullTimeEmployees: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

async function getStockQuote(symbol: string): Promise<StockQuote> {
  const quote: any = await yahooFinance.quote(symbol);

  return {
    symbol: quote.symbol,
    shortName: quote.shortName ?? null,
    regularMarketPrice: quote.regularMarketPrice ?? null,
    regularMarketChange: quote.regularMarketChange ?? null,
    regularMarketChangePercent: quote.regularMarketChangePercent ?? null,
    regularMarketVolume: quote.regularMarketVolume ?? null,
    regularMarketOpen: quote.regularMarketOpen ?? null,
    regularMarketDayHigh: quote.regularMarketDayHigh ?? null,
    regularMarketDayLow: quote.regularMarketDayLow ?? null,
    regularMarketPreviousClose: quote.regularMarketPreviousClose ?? null,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? null,
    marketCap: quote.marketCap ?? null,
    currency: quote.currency ?? null,
    exchange: quote.exchange ?? null,
  };
}

async function getStockHistory(
  symbol: string,
  period: string = "1mo"
): Promise<HistoricalData[]> {
  // Map friendly period names to yahoo-finance2 format
  const periodMap: Record<string, { period1: Date; period2: Date }> = {
    "1d": {
      period1: new Date(Date.now() - 24 * 60 * 60 * 1000),
      period2: new Date(),
    },
    "5d": {
      period1: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      period2: new Date(),
    },
    "1mo": {
      period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      period2: new Date(),
    },
    "3mo": {
      period1: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      period2: new Date(),
    },
    "6mo": {
      period1: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      period2: new Date(),
    },
    "1y": {
      period1: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      period2: new Date(),
    },
    "2y": {
      period1: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000),
      period2: new Date(),
    },
    "5y": {
      period1: new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000),
      period2: new Date(),
    },
  };

  const dates = periodMap[period] || periodMap["1mo"];

  const history: any = await yahooFinance.historical(symbol, {
    period1: dates.period1,
    period2: dates.period2,
  });

  return history.map((item: any) => ({
    date: item.date.toISOString().split("T")[0],
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    volume: item.volume,
    adjClose: item.adjClose,
  }));
}

async function getCompanyProfile(symbol: string): Promise<CompanyProfile> {
  const [quote, quoteSummary]: [any, any] = await Promise.all([
    yahooFinance.quote(symbol),
    yahooFinance.quoteSummary(symbol, {
      modules: ["assetProfile", "summaryDetail", "defaultKeyStatistics"],
    }),
  ]);

  const profile = quoteSummary.assetProfile;
  const summary = quoteSummary.summaryDetail;

  return {
    symbol: quote.symbol,
    shortName: quote.shortName ?? null,
    longName: quote.longName ?? null,
    industry: profile?.industry ?? null,
    sector: profile?.sector ?? null,
    website: profile?.website ?? null,
    longBusinessSummary: profile?.longBusinessSummary ?? null,
    fullTimeEmployees: profile?.fullTimeEmployees ?? null,
    city: profile?.city ?? null,
    state: profile?.state ?? null,
    country: profile?.country ?? null,
    marketCap: quote.marketCap ?? null,
    trailingPE: summary?.trailingPE ?? null,
    forwardPE: summary?.forwardPE ?? null,
    dividendYield: summary?.dividendYield ?? null,
    fiftyTwoWeekHigh: summary?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: summary?.fiftyTwoWeekLow ?? null,
  };
}

async function searchStocks(
  query: string
): Promise<Array<{ symbol: string; name: string; type: string; exchange: string }>> {
  const results: any = await yahooFinance.search(query);

  return (results.quotes || [])
    .filter((q: any) => q.symbol && q.shortname)
    .slice(0, 10)
    .map((q: any) => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || "",
      type: q.quoteType || "",
      exchange: q.exchange || "",
    }));
}

const server = new Server(
  { name: "yahoo-finance", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_stock_quote",
      description:
        "Get the current stock quote including price, change, volume, and key metrics. Use stock ticker symbols like AAPL, GOOGL, MSFT, TSLA.",
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
      name: "get_stock_history",
      description:
        "Get historical stock prices for a given period. Returns daily open, high, low, close, and volume.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol (e.g., AAPL, GOOGL, MSFT)",
          },
          period: {
            type: "string",
            enum: ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"],
            description:
              "Time period for historical data (default: 1mo). Options: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "get_company_profile",
      description:
        "Get detailed company profile including business summary, industry, sector, employees, and key financial metrics.",
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
      name: "search_stocks",
      description:
        "Search for stocks by company name or ticker symbol. Returns matching stocks with their symbols and exchanges.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Search query - company name or partial ticker (e.g., 'Apple', 'Tesla', 'tech')",
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
      const quote = await getStockQuote(symbol.toUpperCase());
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

  if (name === "get_stock_history") {
    const { symbol, period = "1mo" } = args as {
      symbol: string;
      period?: string;
    };

    try {
      const history = await getStockHistory(symbol.toUpperCase(), period);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                symbol: symbol.toUpperCase(),
                period,
                dataPoints: history.length,
                history,
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
        content: [
          { type: "text", text: `Failed to get history for ${symbol}: ${errMsg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "get_company_profile") {
    const { symbol } = args as { symbol: string };

    try {
      const profile = await getCompanyProfile(symbol.toUpperCase());
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
        content: [
          { type: "text", text: `Failed to get profile for ${symbol}: ${errMsg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "search_stocks") {
    const { query } = args as { query: string };

    try {
      const results = await searchStocks(query);
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Yahoo Finance MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
