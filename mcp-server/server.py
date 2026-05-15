import os

import wikipedia
import yfinance as yf
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from serpapi import GoogleSearch
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


SERPAPI_API_KEY = os.environ.get("SERPAPI_API_KEY")
MCP_API_KEY = os.environ.get("MCP_API_KEY")


class ApiKeyAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/mcp"):
            if not MCP_API_KEY or request.headers.get("x-api-key") != MCP_API_KEY:
                return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


mcp = FastMCP(
    "finbot-tools",
    stateless_http=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@mcp.tool()
def get_stock_fundamentals(ticker: str) -> dict:
    """Fetch a current SNAPSHOT of fundamentals for a publicly traded stock.

    Use this for: current price, P/E ratio, market cap, revenue growth, and the
    52-week high/low *numbers* (two values). Sourced from Yahoo Finance.

    DO NOT use this when the user asks for a chart, graph, plot, trend, or
    historical performance — this returns ONLY two scalar values for the
    52-week range (high and low), not a time series. The frontend cannot render
    a chart from this tool's output. For chart/graph/trend/historical queries,
    call get_price_history instead.
    """
    stock = yf.Ticker(ticker)
    info = stock.info or {}
    return {
        "ticker": ticker.upper(),
        "price": info.get("currentPrice"),
        "pe_ratio": info.get("trailingPE"),
        "market_cap": info.get("marketCap"),
        "revenue_growth": info.get("revenueGrowth"),
        "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
    }


@mcp.tool()
def get_price_history(ticker: str, period: str = "1y") -> dict:
    """Fetch a daily price-history TIME SERIES for a stock; the UI renders it as a chart.

    YOU MUST CALL THIS TOOL whenever the user asks for any of:
      - a "chart", "graph", "plot", "visual" of a stock
      - "show me" a stock's prices
      - a "52-week chart" or "annual chart" (use period="1y")
      - historical performance, trend, or movement over time
      - "how did X perform this month/quarter/year"
      - "compare X and Y" over a period (call twice, once per ticker)

    DO NOT substitute get_stock_fundamentals for these queries. Fundamentals
    only returns the high and low NUMBERS, not the day-by-day series, and the
    frontend cannot render a chart from a snapshot.

    DO NOT say "I cannot show charts" or refer the user to external sites.
    The frontend renders an inline chart card automatically from this tool's
    output — your job is to call this tool, then write a 2-3 sentence
    narrative referencing the stats (start, end, high, low, pct_change).

    Args:
        ticker: Symbol like AAPL, MSFT, TSLA.
        period: One of "1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max".
            Default "1y" (covers 52 weeks). For "52-week" or "annual" use "1y".

    Returns:
        {ticker, period, points: [{t: ISO date, c: close}], stats: {start, end,
        high, low, pct_change}}. The points drive the chart; the stats are for
        your written narrative.
    """
    allowed = {"1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max"}
    if period not in allowed:
        period = "1y"

    stock = yf.Ticker(ticker)
    hist = stock.history(period=period, auto_adjust=False)
    if hist is None or hist.empty:
        return {
            "ticker": ticker.upper(),
            "period": period,
            "points": [],
            "stats": {},
            "error": f"No price history available for {ticker.upper()}.",
        }

    closes = hist["Close"].dropna()
    points = [
        {"t": ts.strftime("%Y-%m-%d"), "c": round(float(c), 4)}
        for ts, c in closes.items()
    ]
    start = float(closes.iloc[0])
    end = float(closes.iloc[-1])
    pct = ((end - start) / start) * 100.0 if start else 0.0

    return {
        "ticker": ticker.upper(),
        "period": period,
        "points": points,
        "stats": {
            "start": round(start, 4),
            "end": round(end, 4),
            "high": round(float(closes.max()), 4),
            "low": round(float(closes.min()), 4),
            "pct_change": round(pct, 2),
        },
    }


@mcp.tool()
def get_yahoo_finance_news(ticker: str) -> str:
    """Fetch recent news headlines for a stock ticker from Yahoo Finance.

    Use this for stock-specific news (earnings, analyst actions, company events).
    Returns concatenated headlines and summaries.
    """
    stock = yf.Ticker(ticker)
    news_items = stock.news or []
    if not news_items:
        return f"No recent Yahoo Finance news for {ticker.upper()}."
    lines = []
    for item in news_items[:10]:
        content = item.get("content", item)
        title = content.get("title") or item.get("title", "")
        summary = content.get("summary") or content.get("description", "")
        if title:
            lines.append(f"- {title}: {summary}".strip())
    return "\n".join(lines) if lines else f"No headlines available for {ticker.upper()}."


@mcp.tool()
def search_news(query: str) -> str:
    """Search Google News for headlines from the last 24 hours.

    Use this for broad market or macro news (e.g. "Fed rate decision",
    "semiconductor demand"). For company-specific stock news, prefer
    get_yahoo_finance_news. Returns a text summary of top headlines.
    """
    if not SERPAPI_API_KEY:
        return "SERPAPI_API_KEY is not configured on the MCP server."
    search = GoogleSearch(
        {
            "q": query,
            "tbm": "nws",
            "tbs": "qdr:d",
            "api_key": SERPAPI_API_KEY,
        }
    )
    results = search.get_dict()
    items = results.get("news_results", [])
    if not items:
        return f"No news results found for: {query}"
    lines = []
    for item in items[:10]:
        title = item.get("title", "")
        source = item.get("source", "")
        snippet = item.get("snippet", "")
        lines.append(f"- [{source}] {title}: {snippet}".strip())
    return "\n".join(lines)


@mcp.tool()
def wikipedia_lookup(query: str) -> str:
    """Look up background information from Wikipedia.

    Use this for context on companies, industries, executives, financial
    concepts, or historical events. Returns a summary of the most relevant
    article. Do not use for current prices or news.
    """
    try:
        return wikipedia.summary(query, sentences=5, auto_suggest=True, redirect=True)
    except wikipedia.DisambiguationError as e:
        options = ", ".join(e.options[:5])
        return f"Ambiguous query. Try one of: {options}"
    except wikipedia.PageError:
        return f"No Wikipedia page found for: {query}"


app = mcp.streamable_http_app()
app.add_middleware(ApiKeyAuthMiddleware)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)
