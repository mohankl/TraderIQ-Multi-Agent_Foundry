import os
from datetime import datetime, timezone

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


def _as_of_from_unix(ts: float | int | None) -> str | None:
    """Convert a Unix timestamp (seconds) to an ISO-8601 UTC string."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except (ValueError, OSError, TypeError):
        return None


def _market_cap_tier(cap: float | None) -> str | None:
    """Classify market cap into the standard tiers used by analysts."""
    if cap is None:
        return None
    if cap >= 200_000_000_000:
        return "Mega-Cap"
    if cap >= 10_000_000_000:
        return "Large-Cap"
    if cap >= 2_000_000_000:
        return "Mid-Cap"
    if cap >= 300_000_000:
        return "Small-Cap"
    return "Micro-Cap"


@mcp.tool()
def get_stock_fundamentals(ticker: str) -> dict:
    """Fetch a current SNAPSHOT of fundamentals for a publicly traded stock.

    WHEN TO CALL THIS TOOL — whenever the user asks for any of:
      - "fundamentals", "snapshot", "stats", "details", or "info" of a stock
      - "show me the card", "stock card", "details card" for a ticker
      - current price, P/E ratio, market cap, dividend yield, ROE, volume
      - the 52-week range *numbers* (two scalar values)

    DO NOT use this for a CHART, GRAPH, PLOT, TREND, or HISTORICAL performance
    — this returns only scalar snapshot values, not a time series. For those
    queries, call get_price_history instead.

    DIVISION OF LABOR — read carefully:
      The frontend renders an inline stock-card UI directly from this tool's
      structured output. The card already shows: ticker, exchange, sector,
      price, intraday change, 52-week range, market cap (with tier), P/E,
      dividend yield, ROE, and volume.

      Your reply should NOT restate any of those numbers. The card shows them.
      Restating them creates contradiction risk and wastes the user's time.

      Your reply SHOULD contain interpretation that the card cannot express:
        - valuation judgement ("fairly valued given the P/E", "rich vs sector")
        - notable news context (one or two recent drivers, not a full list)
        - 1-2 key risks
        - a one-line outlook

      GOOD reply (≈3 short bullets, no raw numbers):
        "MSFT looks fairly valued given steady revenue growth and a moderate
        P/E vs peers. Recent attention has centered on AI ecosystem moves
        and workforce changes; legal exposure around AI partnerships is the
        notable risk. Outlook: stable execution, watch regulatory headlines."

      BAD reply (just restates the card):
        "MSFT is at $409.43 with a P/E of 24.16 and market cap $3.04T. The
        52-week range is X to Y..." — DO NOT DO THIS.

    Args:
        ticker: Symbol like AAPL, MSFT, TSLA.

    Returns:
        A self-describing envelope: `{"data": {...fundamentals fields..., "as_of": ISO timestamp},
        "render": {"kind": "stock_card"}}`. The agent reads `data` for context;
        FastAPI forwards the envelope to the frontend as a UI render hint.
        Sourced from Yahoo Finance.
    """
    stock = yf.Ticker(ticker)
    info = stock.info or {}
    price = info.get("currentPrice") or info.get("regularMarketPrice")
    prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")
    change = None
    change_pct = None
    if isinstance(price, (int, float)) and isinstance(prev_close, (int, float)) and prev_close:
        change = round(price - prev_close, 2)
        change_pct = round((change / prev_close) * 100.0, 2)

    market_cap = info.get("marketCap")
    as_of = _as_of_from_unix(info.get("regularMarketTime"))
    data = {
        "ticker": ticker.upper(),
        "name": info.get("longName") or info.get("shortName"),
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "sector": info.get("sector"),
        "price": price,
        "previous_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "pe_ratio": info.get("trailingPE"),
        "market_cap": market_cap,
        "market_cap_tier": _market_cap_tier(market_cap),
        "revenue_growth": info.get("revenueGrowth"),
        "dividend_yield": info.get("dividendYield"),
        "return_on_equity": info.get("returnOnEquity"),
        "volume": info.get("volume") or info.get("regularMarketVolume"),
        "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
        "as_of": as_of,
    }
    return {"data": data, "render": {"kind": "stock_card"}}


@mcp.tool()
def get_price_history(ticker: str, period: str = "1y") -> dict:
    """Fetch a daily price-history TIME SERIES for a stock; the UI renders it as a chart.

    WHEN TO CALL THIS TOOL — whenever the user asks for any of:
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

    DIVISION OF LABOR — read carefully:
      The frontend renders an inline chart card directly from this tool's
      structured output. The chart already shows: ticker, period, start/end
      prices, high, low, and percent change.

      Your reply should NOT restate any of those numbers. The chart shows them.
      Restating them creates contradiction risk and wastes the user's time.

      Your reply SHOULD contain interpretation the chart cannot express:
        - the shape of the move ("steady uptrend", "V-shaped recovery",
          "sideways with two pullbacks")
        - the most likely *why* if obvious from the date range (earnings,
          macro events) — call get_yahoo_finance_news only if the answer
          requires it
        - one risk to watch

      GOOD reply:
        "NVDA traced a strong uptrend over the past 12 months, with one
        notable pullback in mid-October before recovering to new highs.
        Momentum has been carried by AI-related demand; watch for
        guidance revisions if data-center growth decelerates."

      BAD reply (just restates the chart):
        "NVDA started at $X, hit a high of $Y, ended at $Z, gaining N%." —
        DO NOT DO THIS.

    Args:
        ticker: Symbol like AAPL, MSFT, TSLA.
        period: One of "1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max".
            Default "1y" (covers 52 weeks). For "52-week" or "annual" use "1y".

    Returns:
        A self-describing envelope: `{"data": {ticker, period, points, stats, "as_of": ISO},
        "render": {"kind": "chart", "chartType": "line"}}`. The agent reads
        `data.stats` for context; the frontend renders an inline chart card.
    """
    allowed = {"1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max"}
    if period not in allowed:
        period = "1y"

    stock = yf.Ticker(ticker)
    hist = stock.history(period=period, auto_adjust=False)
    if hist is None or hist.empty:
        return {
            "data": {
                "ticker": ticker.upper(),
                "period": period,
                "points": [],
                "stats": {},
                "error": f"No price history available for {ticker.upper()}.",
            },
            "render": {"kind": "chart", "chartType": "line"},
        }

    closes = hist["Close"].dropna()
    points = [
        {"t": ts.strftime("%Y-%m-%d"), "c": round(float(c), 4)}
        for ts, c in closes.items()
    ]
    start = float(closes.iloc[0])
    end = float(closes.iloc[-1])
    pct = ((end - start) / start) * 100.0 if start else 0.0
    last_ts = closes.index[-1]
    # Pandas Timestamps from yfinance are tz-aware on most exchanges. isoformat()
    # works for both naive and tz-aware variants.
    as_of = last_ts.isoformat() if last_ts is not None else None

    data = {
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
        "as_of": as_of,
    }
    return {"data": data, "render": {"kind": "chart", "chartType": "line"}}


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
