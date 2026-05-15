"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartRenderPayload } from "@/lib/threads";

interface ChartCardProps {
  payload: ChartRenderPayload;
}

function formatPrice(n: number): string {
  return n >= 100 ? n.toFixed(0) : n.toFixed(2);
}

function formatDate(d: string): string {
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChartCard({ payload }: ChartCardProps) {
  const { ticker, period, points, stats } = payload;
  if (!points?.length || !stats) {
    return (
      <div className="my-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Chart data unavailable for {ticker}.
      </div>
    );
  }
  const up = stats.pct_change >= 0;
  const stroke = up ? "rgb(16 185 129)" : "rgb(239 68 68)";

  return (
    <div className="my-3 rounded-xl border border-border bg-card px-4 py-3">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">{ticker}</span>
          <span className="text-xs uppercase text-muted-foreground">
            {period}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">${formatPrice(stats.end)}</span>
          <span
            className={cn(
              "flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium",
              up
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-red-500/10 text-red-500"
            )}
          >
            {up ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {stats.pct_change.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="mt-3 h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              stroke="hsl(var(--border))"
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              tickFormatter={formatDate}
              minTickGap={40}
              tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => `$${formatPrice(v)}`}
              tick={{ fontSize: 10 }}
              width={48}
              stroke="hsl(var(--muted-foreground))"
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(d) => (typeof d === "string" ? formatDate(d) : String(d))}
              formatter={(v) => [
                typeof v === "number" ? `$${formatPrice(v)}` : String(v),
                "Close",
              ]}
            />
            <ReferenceLine
              y={stats.high}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeOpacity={0.4}
            />
            <ReferenceLine
              y={stats.low}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeOpacity={0.4}
            />
            <Line
              type="monotone"
              dataKey="c"
              stroke={stroke}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Footer stats */}
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>
          High <span className="text-foreground">${formatPrice(stats.high)}</span>
        </span>
        <span>
          Low <span className="text-foreground">${formatPrice(stats.low)}</span>
        </span>
        <span>
          {points.length} pts
        </span>
      </div>
    </div>
  );
}
