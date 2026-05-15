"use client";

import { ChartCard } from "@/components/chart-card";
import type { RenderPayload } from "@/lib/threads";

/** Routes an agent-emitted UI payload to a concrete React component.
 *
 * Add new `kind`s here as the agent gains tools that produce structured
 * outputs (heatmap, table, gauge, etc).
 */
export function RenderSlot({ payload }: { payload: RenderPayload }) {
  // When a new `kind` is added to the RenderPayload union, add a case here.
  // TypeScript will narrow `payload` based on `kind`.
  if (payload.kind === "chart") return <ChartCard payload={payload} />;
  return null;
}
