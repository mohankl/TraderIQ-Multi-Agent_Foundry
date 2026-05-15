"use client";

/**
 * Tiny footer that shows the provenance of a render payload: when the data
 * was captured (as_of) and which tool call produced it. Helpful when the
 * narrative and the card seem to disagree — you can see whether the data is
 * stale or whether the LLM hallucinated.
 *
 * In production set NEXT_PUBLIC_SHOW_RENDER_DEBUG=false to hide the tool
 * call id; the timestamp stays visible since it's useful to end users too.
 */
interface RenderSourceProps {
  as_of?: string | null;
  source_tool_call_id?: string | null;
}

function formatAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // "as of May 14, 09:00 PDT" — concise but unambiguous.
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function RenderSource({ as_of, source_tool_call_id }: RenderSourceProps) {
  const showDebug = process.env.NEXT_PUBLIC_SHOW_RENDER_DEBUG !== "false";
  const asOfLabel = formatAsOf(as_of);
  if (!asOfLabel && !source_tool_call_id) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
      {asOfLabel ? <span>as of {asOfLabel}</span> : null}
      {showDebug && source_tool_call_id ? (
        <span className="font-mono opacity-60">{source_tool_call_id}</span>
      ) : null}
    </div>
  );
}
