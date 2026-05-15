// Pure functions for the in-flight assistant bubble's segment list and
// the live → persisted-message flattening. Kept out of chat-area.tsx so
// they can be unit-tested without a React renderer.

import type { RenderPayload } from "@/lib/threads";
import type { StepState } from "@/components/step-pill";
import type { RenderGroupRun } from "@/components/render-group";

/** AG-UI event shape on the wire (subset we actually inspect). */
export interface AGUIEvent {
  type: string;
  threadId?: string;
  runId?: string;
  messageId?: string;
  delta?: string;
  message?: string;
  name?: string;
  value?: unknown;
  stepName?: string;
}

/** Ordered segments that make up the live (in-flight) assistant message.
 * Once the run finishes we flatten this back into `Message.content` +
 * `renderSlots` for persistence. Keeping the segment order in memory is
 * what enables interleaved rendering — a card can appear *before* the text
 * that references it. */
export type LiveSegment =
  | { kind: "text"; text: string }
  | { kind: "step"; step: StepState }
  | { kind: "render"; payload: RenderPayload };

export interface LiveAssistant {
  segments: LiveSegment[];
}

/** A render-ready chunk: render segments of the same kind merge into a
 * group so the comparison-card grid can render them side-by-side. */
export type LiveDisplayChunk =
  | { kind: "step"; step: StepState }
  | { kind: "text"; text: string }
  | { kind: "renderGroup"; group: RenderGroupRun };

export function isRenderPayload(value: unknown): value is RenderPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as { kind?: unknown };
  return v.kind === "chart" || v.kind === "stock_card";
}

/** Append a delta to the most recent text segment, OR start a new one if
 * the previous segment was anything else (step pill, render, or a
 * different text block). The caller may also pass `forceNewSegment=true`
 * when it sees a `TEXT_MESSAGE_START` to force a paragraph break — the
 * agent emits a fresh message item every time it resumes after a tool
 * call, and those should not visually merge with the prior text. */
export function appendOrCreateText(
  segments: LiveSegment[],
  delta: string,
  forceNewSegment = false
): LiveSegment[] {
  const last = segments[segments.length - 1];
  if (!forceNewSegment && last && last.kind === "text") {
    return [
      ...segments.slice(0, -1),
      { kind: "text", text: last.text + delta },
    ];
  }
  return [...segments, { kind: "text", text: delta }];
}

/** Walk live.segments and merge consecutive `render` segments of the same
 * `kind` into one grouped chunk. Step pills and text segments stay as-is.
 * This is what enables side-by-side comparison cards in the in-flight
 * bubble, mirroring the grouping the persisted message gets in
 * chat-message.tsx. */
export function chunkLiveSegments(segments: LiveSegment[]): LiveDisplayChunk[] {
  const chunks: LiveDisplayChunk[] = [];
  for (const seg of segments) {
    if (seg.kind === "render") {
      const last = chunks[chunks.length - 1];
      if (
        last &&
        last.kind === "renderGroup" &&
        last.group.kind === seg.payload.kind
      ) {
        last.group.items.push(seg.payload);
      } else {
        chunks.push({
          kind: "renderGroup",
          group: { kind: seg.payload.kind, items: [seg.payload] },
        });
      }
    } else if (seg.kind === "step") {
      chunks.push({ kind: "step", step: seg.step });
    } else {
      chunks.push({ kind: "text", text: seg.text });
    }
  }
  return chunks;
}

/** Flatten the live segment list into the persisted Message shape: a
 * single markdown string + an ordered list of RenderPayloads. Distinct
 * text segments are joined with a blank line so markdown renders them as
 * separate blocks instead of running headings/bullets together. */
export function flattenLive(live: LiveAssistant): {
  text: string;
  renderSlots: RenderPayload[];
} {
  const textChunks: string[] = [];
  const renderSlots: RenderPayload[] = [];
  for (const seg of live.segments) {
    if (seg.kind === "text") textChunks.push(seg.text);
    else if (seg.kind === "render") renderSlots.push(seg.payload);
  }
  return { text: textChunks.join("\n\n"), renderSlots };
}
