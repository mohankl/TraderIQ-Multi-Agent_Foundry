"use client";

import { cn } from "@/lib/utils";
import type {
  RenderPayload,
  StockCardRenderPayload,
} from "@/lib/threads";
import { RenderSlot } from "@/components/render-slot";

/** Group consecutive same-`kind` render payloads so we can render them
 * side-by-side (and, for stock_cards, with a delta row). A run of length 1
 * renders as a normal solo card. */
export interface RenderGroupRun {
  kind: RenderPayload["kind"];
  items: RenderPayload[];
}

export function groupRenderSlots(slots: RenderPayload[]): RenderGroupRun[] {
  const groups: RenderGroupRun[] = [];
  for (const slot of slots) {
    const last = groups[groups.length - 1];
    if (last && last.kind === slot.kind) {
      last.items.push(slot);
    } else {
      groups.push({ kind: slot.kind, items: [slot] });
    }
  }
  return groups;
}

/** Render a single group. Up to 2 items get a 2-column grid; beyond that
 * we fall back to the original stacked layout (rare; would need 3+ tools
 * of the same kind in one turn). */
export function RenderGroup({ group }: { group: RenderGroupRun }) {
  if (group.items.length === 1) {
    return <RenderSlot payload={group.items[0]} />;
  }

  if (group.items.length === 2) {
    const [a, b] = group.items;
    return (
      <div className="my-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Override the per-card my-3 with my-0 inside the grid by wrapping. */}
          <div className="[&>*]:my-0">
            <RenderSlot payload={a} />
          </div>
          <div className="[&>*]:my-0">
            <RenderSlot payload={b} />
          </div>
        </div>
        {group.kind === "stock_card" && (
          <StockCardDeltaRow
            left={a as StockCardRenderPayload}
            right={b as StockCardRenderPayload}
          />
        )}
      </div>
    );
  }

  // 3+ items: stack normally. Comparison row only applies to pairs.
  return (
    <>
      {group.items.map((p, i) => (
        <RenderSlot key={i} payload={p} />
      ))}
    </>
  );
}

interface StockCardDeltaRowProps {
  left: StockCardRenderPayload;
  right: StockCardRenderPayload;
}

/** Compact delta strip shown under two stock cards.
 *
 * Notes on the metrics:
 *  - P/E diff: `right.pe_ratio - left.pe_ratio`. Positive means the right
 *    card trades at a richer multiple than the left.
 *  - "vs 52w low" % is a deliberate proxy for 1Y change. We don't have an
 *    authoritative 1Y % on the card today, so we anchor against the
 *    52-week low — labeled honestly. If we later add a real
 *    `price_change_1y_pct` to the fundamentals envelope, swap to that.
 *  - Market-cap tier: categorical compare; if they match we say "same tier".
 */
function StockCardDeltaRow({ left, right }: StockCardDeltaRowProps) {
  const peDiff =
    left.pe_ratio != null && right.pe_ratio != null
      ? right.pe_ratio - left.pe_ratio
      : null;

  const fromLow = (price?: number | null, low?: number | null) =>
    price != null && low != null && low > 0 ? ((price - low) / low) * 100 : null;
  const leftVsLow = fromLow(left.price, left.fifty_two_week_low);
  const rightVsLow = fromLow(right.price, right.fifty_two_week_low);

  const tierMatch =
    left.market_cap_tier &&
    right.market_cap_tier &&
    left.market_cap_tier === right.market_cap_tier;

  // If no metrics resolved, skip the row entirely to avoid an empty strip.
  const hasAny =
    peDiff != null || leftVsLow != null || rightVsLow != null || tierMatch != null;
  if (!hasAny) return null;

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-xs sm:grid-cols-3">
      {peDiff != null && (
        <DeltaCell
          label={`ΔP/E (${right.ticker} − ${left.ticker})`}
          value={peDiff}
          format={(v) => v.toFixed(2)}
          hint={
            peDiff > 0
              ? `${right.ticker} richer`
              : peDiff < 0
                ? `${left.ticker} richer`
                : "equal"
          }
        />
      )}
      {leftVsLow != null && rightVsLow != null && (
        <DeltaCell
          label="vs 52-week low"
          value={null}
          format={() =>
            `${left.ticker} +${leftVsLow.toFixed(0)}% · ${right.ticker} +${rightVsLow.toFixed(0)}%`
          }
          hint={
            leftVsLow > rightVsLow
              ? `${left.ticker} stronger off the low`
              : rightVsLow > leftVsLow
                ? `${right.ticker} stronger off the low`
                : "matched"
          }
        />
      )}
      {(left.market_cap_tier || right.market_cap_tier) && (
        <DeltaCell
          label="Market-cap tier"
          value={null}
          format={() =>
            tierMatch
              ? `Both ${left.market_cap_tier}`
              : `${left.market_cap_tier ?? "—"} · ${right.market_cap_tier ?? "—"}`
          }
        />
      )}
    </div>
  );
}

interface DeltaCellProps {
  label: string;
  value: number | null;
  format: (v: number) => string;
  hint?: string;
}

function DeltaCell({ label, value, format, hint }: DeltaCellProps) {
  const tone =
    value == null
      ? "text-foreground"
      : value > 0
        ? "text-emerald-500"
        : value < 0
          ? "text-red-500"
          : "text-foreground";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-sm font-medium tabular-nums", tone)}>
        {value != null ? `${value > 0 ? "+" : ""}${format(value)}` : format(0)}
      </span>
      {hint ? (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}
