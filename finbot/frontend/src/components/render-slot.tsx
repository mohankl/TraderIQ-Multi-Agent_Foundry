"use client";

import { ChartCard } from "@/components/chart-card";
import { StockCard } from "@/components/stock-card";
import type { RenderPayload } from "@/lib/threads";

/** Routes an agent-emitted UI payload to a concrete React component.
 *
 * Add new `kind`s here as the agent gains tools that produce structured
 * outputs (heatmap, table, gauge, etc).
 */
export function RenderSlot({ payload }: { payload: RenderPayload }) {
  if (payload.kind === "chart") return <ChartCard payload={payload} />;
  if (payload.kind === "stock_card") return <StockCard payload={payload} />;
  return null;
}
