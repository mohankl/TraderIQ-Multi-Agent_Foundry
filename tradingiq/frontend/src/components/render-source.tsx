"use client";

/**
 * Tiny footer that shows when the data was captured (as_of). The
 * `source_tool_call_id` stays in the payload for support/debugging but is
 * no longer rendered in the UI — it was visual noise, especially in the
 * comparison layout.
 */
interface RenderSourceProps {
  as_of?: string | null;
  // Kept on the props so existing callers still type-check, but intentionally unused.
  source_tool_call_id?: string | null;
}

function formatAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Date only — drop the time/timezone clutter.
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function RenderSource({ as_of }: RenderSourceProps) {
  const asOfLabel = formatAsOf(as_of);
  if (!asOfLabel) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
      <span>as of {asOfLabel}</span>
    </div>
  );
}
