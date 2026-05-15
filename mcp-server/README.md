# tradingiq-mcp

MCP server exposing Trading IQ's tools to Microsoft Foundry agents.

## Tools

- `get_stock_fundamentals(ticker)` — price, P/E, market cap, revenue growth, 52w range (yfinance)
- `get_yahoo_finance_news(ticker)` — stock-specific news headlines (yfinance)
- `search_news(query)` — last-24h Google News via SerpAPI
- `wikipedia_lookup(query)` — Wikipedia article summaries

## Auth

Every request to `/mcp` requires header `X-API-Key: <MCP_API_KEY>`.

## Env vars

| Var | Required | Notes |
|---|---|---|
| `MCP_API_KEY` | yes | Shared secret between MCP server and Foundry Toolbox |
| `SERPAPI_API_KEY` | optional | If unset, `search_news` returns an error message |

## Run locally

```bash
uv sync
MCP_API_KEY=dev-key SERPAPI_API_KEY=... uv run python server.py
```

Server listens on `http://0.0.0.0:8080/mcp`.
