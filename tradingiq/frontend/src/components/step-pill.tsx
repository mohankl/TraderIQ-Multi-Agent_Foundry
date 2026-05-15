"use client";

import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepState {
  /** Server step name, e.g. "tool:get_stock_fundamentals". */
  name: string;
  status: "running" | "done";
}

const TOOL_LABELS: Record<string, string> = {
  get_stock_fundamentals: "Fetching fundamentals",
  get_price_history: "Fetching price history",
  get_yahoo_finance_news: "Fetching Yahoo news",
  search_news: "Searching news",
  wikipedia_lookup: "Looking up Wikipedia",
};

function labelFor(name: string): string {
  if (name.startsWith("tool:")) {
    const tool = name.slice(5);
    return TOOL_LABELS[tool] ?? `Calling ${tool}`;
  }
  return name;
}

interface StepPillProps {
  step: StepState;
}

export function StepPill({ step }: StepPillProps) {
  const running = step.status === "running";
  return (
    <div
      className={cn(
        "my-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        running
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
      )}
      aria-live="polite"
    >
      {running ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Check className="h-3 w-3" />
      )}
      <span>{labelFor(step.name)}</span>
      {running ? <span className="text-muted-foreground">…</span> : null}
    </div>
  );
}
