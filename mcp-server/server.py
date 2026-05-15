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
    """Fetch current fundamentals for a publicly traded stock.

    Use this to get price, P/E ratio, market cap, revenue growth, and 52-week
    range for any ticker symbol (e.g. AAPL, MSFT, TSLA). Returns structured
    numeric data sourced from Yahoo Finance. Prefer this over web search when
    the user asks about price, valuation multiples, or financial metrics.
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
    """Fetch a price-history time series for a stock so the UI can render a chart.

    Use this whenever the user asks for a chart, graph, trend, or historical
    performance (e.g. "show me Apple's 52-week chart", "TSLA last 6 months",
    "how has NVDA performed this year"). The result is structured and the
    frontend renders it as an inline chart card.

    Args:
        ticker: Symbol like AAPL, MSFT, TSLA.
        period: Period string accepted by yfinance. One of
            "1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max".
            Defaults to "1y" (which covers 52 weeks).

    Returns:
        A dict with `ticker`, `period`, `points` (list of {t, c} where t is
        ISO date and c is the close), and `stats` (start, end, high, low,
        pct_change). The agent should reference the stats in its written
        summary; the points array drives the chart on the frontend.
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
