"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StockCardRenderPayload } from "@/lib/threads";
import { RenderSource } from "@/components/render-source";

interface StockCardProps {
  payload: StockCardRenderPayload;
}

function formatPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return n >= 100 ? n.toFixed(2) : n.toFixed(2);
}

function formatLargeNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatPercent(n: number | null | undefined): string {
  if (n == null) return "—";
  // yfinance returns dividendYield/returnOnEquity as decimals (0.005 = 0.5%).
  // It returns revenueGrowth as a decimal too. We pass scaled inputs to this
  // function (caller multiplies by 100 if needed).
  return `${n.toFixed(2)}%`;
}

function rangePosition(
  price: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined
): number | null {
  if (price == null || low == null || high == null || high <= low) return null;
  const pct = ((price - low) / (high - low)) * 100;
  return Math.max(0, Math.min(100, pct));
}

interface MetricProps {
  label: string;
  value: string;
  hint?: string;
}

function Metric({ label, value, hint }: MetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">
        {value}
        {hint ? (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function StockCard({ payload }: StockCardProps) {
  const {
    ticker,
    name,
    exchange,
    sector,
    price,
    change,
    change_pct,
    market_cap,
    market_cap_tier,
    pe_ratio,
    dividend_yield,
    return_on_equity,
    volume,
    fifty_two_week_high,
    fifty_two_week_low,
    as_of,
    source_tool_call_id,
  } = payload;

  const up = (change_pct ?? 0) >= 0;
  const rangePct = rangePosition(
    price,
    fifty_two_week_low,
    fifty_two_week_high
  );

  return (
    <div className="my-3 rounded-xl border border-border bg-card px-5 py-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight">
              {ticker}
            </span>
            {name ? (
              <span className="truncate text-sm text-muted-foreground">
                {name}
              </span>
            ) : null}
          </div>
          {(exchange || sector) && (
            <div className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
              {[exchange, sector].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>

      {/* Price + change */}
      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-2xl font-semibold tabular-nums">
          ${formatPrice(price)}
        </span>
        {change != null && change_pct != null && (
          <span
            className={cn(
              "flex items-center gap-1 text-sm font-medium tabular-nums",
              up ? "text-emerald-500" : "text-red-500"
            )}
          >
            {up ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {up ? "+" : ""}
            {change.toFixed(2)} ({up ? "+" : ""}
            {change_pct.toFixed(2)}%)
          </span>
        )}
      </div>

      {/* 52-week range bar */}
      {rangePct != null && fifty_two_week_low != null && fifty_two_week_high != null && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>52-week range</span>
            <span className="normal-case text-foreground tabular-nums">
              ${formatPrice(fifty_two_week_low)} – ${formatPrice(fifty_two_week_high)}
            </span>
          </div>
          <div className="relative h-1.5 w-full rounded-full bg-muted">
            <div
              className={cn(
                "absolute -top-1 h-3.5 w-1 rounded-sm",
                up ? "bg-emerald-500" : "bg-red-500"
              )}
              style={{ left: `calc(${rangePct}% - 2px)` }}
              aria-label={`Current price ${rangePct.toFixed(0)}% of 52-week range`}
            />
          </div>
        </div>
      )}

      {/* Metrics grid */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Metric
          label="Market Cap"
          value={market_cap != null ? `$${formatLargeNumber(market_cap)}` : "—"}
          hint={market_cap_tier ?? undefined}
        />
        <Metric
          label="P/E (TTM)"
          value={pe_ratio != null ? pe_ratio.toFixed(2) : "—"}
        />
        <Metric
          label="Dividend Yield"
          value={dividend_yield != null ? formatPercent(dividend_yield) : "—"}
        />
        <Metric
          label="ROE"
          value={
            return_on_equity != null
              ? formatPercent(return_on_equity * 100)
              : "—"
          }
        />
        <Metric label="Volume" value={formatLargeNumber(volume)} />
      </div>

      <RenderSource as_of={as_of} source_tool_call_id={source_tool_call_id} />
    </div>
  );
}
