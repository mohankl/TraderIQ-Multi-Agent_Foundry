"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Thread,
  Message,
  addMessage,
  setThreadForeignId,
} from "@/lib/threads";
import {
  type AGUIEvent,
  type LiveAssistant,
  appendOrCreateText,
  chunkLiveSegments,
  flattenLive,
  isRenderPayload,
} from "@/lib/agui-segments";
import { ChatMessage, TypingIndicator } from "@/components/chat-message";
import { StepPill } from "@/components/step-pill";
import { RenderGroup } from "@/components/render-group";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { TrendingUp, Send, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTIONS = [
  "AAPL fundamentals",
  "Is NVDA overvalued?",
  "TSLA news sentiment",
  "MSFT vs GOOGL",
];

interface ChatAreaProps {
  thread: Thread | null;
  onMessagesUpdated: () => void;
}

function LiveAssistantBubble({ live }: { live: LiveAssistant }) {
  // Don't render an empty bubble — TypingIndicator covers the pre-segment
  // window. An empty card-colored pill on a dark background is invisible
  // and looks like a dead UI element.
  if (live.segments.length === 0) return null;

  // We want consistent visibility for every segment type: step pills, cards,
  // and text. Wrap each kind in its own block at full width with sane gap
  // and DO NOT apply the `bg-card` chrome to the outer container — cards
  // already have their own borders and step pills need real contrast.
  const hasText = live.segments.some((s) => s.kind === "text");
  // After all tools finish but BEFORE the first token of narrative arrives,
  // show a "writing analysis…" status so the user has a continuous signal.
  const allStepsDone = live.segments
    .filter((s) => s.kind === "step")
    .every((s) => s.kind === "step" && s.step.status === "done");
  const hasAnyStep = live.segments.some((s) => s.kind === "step");
  const showWritingHint = hasAnyStep && allStepsDone && !hasText;

  return (
    <div className="flex items-start gap-3 py-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <TrendingUp className="h-4 w-4" />
      </div>
      <div className="flex max-w-[80%] flex-col gap-2 text-sm text-foreground">
        {chunkLiveSegments(live.segments).map((chunk, i) => {
          if (chunk.kind === "step") {
            return <StepPill key={i} step={chunk.step} />;
          }
          if (chunk.kind === "renderGroup") {
            return <RenderGroup key={i} group={chunk.group} />;
          }
          return (
            <div
              key={i}
              className="prose prose-sm dark:prose-invert max-w-none rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 leading-relaxed shadow-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{chunk.text}</ReactMarkdown>
            </div>
          );
        })}
        {showWritingHint && <WritingHint />}
      </div>
    </div>
  );
}

function WritingHint() {
  return (
    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:300ms]" />
      </span>
      <span>Writing analysis</span>
    </div>
  );
}

export function ChatArea({ thread, onMessagesUpdated }: ChatAreaProps) {
  const [localMessages, setLocalMessages] = useState<Message[]>(
    thread?.messages ?? []
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [live, setLive] = useState<LiveAssistant | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgCountRef = useRef(thread?.messages.length ?? 0);

  useEffect(() => {
    const isNewMessage = localMessages.length > msgCountRef.current;
    if (isNewMessage || isLoading || live) {
      msgCountRef.current = localMessages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [localMessages, isLoading, live]);

  const sendQuery = useCallback(
    async (query: string) => {
      if (!query.trim() || !thread || isLoading) return;

      setInput("");
      setError(null);
      setIsLoading(true);
      setLive({ segments: [] });

      const userMsg = addMessage(thread.id, { role: "user", content: query });
      setLocalMessages((prev) => [...prev, userMsg]);
      onMessagesUpdated();

      // Track open steps by name so STEP_FINISHED can transition the right
      // pill. Two same-named steps in flight at once is rare for our 5 MCP
      // tools, so name-based lookup is fine.
      const openStepIndexByName = new Map<string, number>();

      // When TEXT_MESSAGE_START arrives, the next TEXT_MESSAGE_CONTENT delta
      // should start a *new* text segment instead of appending to the prior
      // one. The agent emits a fresh message item every time it resumes
      // after a tool call, and merging two such items into one paragraph
      // produces visible duplication (same headings appearing twice).
      let newTextSegmentPending = false;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: thread.foreignId ?? null,
            messageId: userMsg.id,
            content: query,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let foundryThreadId: string | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const event: AGUIEvent = JSON.parse(line.slice(6));
              if (event.type === "TEXT_MESSAGE_START") {
                newTextSegmentPending = true;
              } else if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
                const delta = event.delta;
                const force = newTextSegmentPending;
                newTextSegmentPending = false;
                setLive((prev) =>
                  prev
                    ? { segments: appendOrCreateText(prev.segments, delta, force) }
                    : prev
                );
              } else if (event.type === "STEP_STARTED" && event.stepName) {
                const name = event.stepName;
                setLive((prev) => {
                  if (!prev) return prev;
                  const idx = prev.segments.length;
                  openStepIndexByName.set(name, idx);
                  return {
                    segments: [
                      ...prev.segments,
                      { kind: "step", step: { name, status: "running" } },
                    ],
                  };
                });
              } else if (event.type === "STEP_FINISHED" && event.stepName) {
                const name = event.stepName;
                const idx = openStepIndexByName.get(name);
                openStepIndexByName.delete(name);
                if (idx != null) {
                  setLive((prev) => {
                    if (!prev) return prev;
                    const segs = prev.segments.slice();
                    const seg = segs[idx];
                    if (seg && seg.kind === "step") {
                      segs[idx] = {
                        kind: "step",
                        step: { name: seg.step.name, status: "done" },
                      };
                    }
                    return { segments: segs };
                  });
                }
              } else if (event.type === "CUSTOM" && event.name === "ui.render") {
                if (isRenderPayload(event.value)) {
                  const payload = event.value;
                  setLive((prev) =>
                    prev
                      ? {
                          segments: [...prev.segments, { kind: "render", payload }],
                        }
                      : prev
                  );
                } else {
                  console.warn("Ignoring ui.render with unknown payload", event.value);
                }
              } else if (event.type === "RUN_FINISHED" && event.threadId) {
                foundryThreadId = event.threadId;
              } else if (event.type === "RUN_ERROR") {
                throw new Error(event.message ?? "Run error");
              }
            } catch (parseErr) {
              console.warn("SSE parse failed", parseErr, line);
            }
          }
        }

        // Flatten the live segments into the persisted message shape.
        setLive((prev) => {
          if (!prev || !thread) return null;
          const { text, renderSlots } = flattenLive(prev);
          if (text || renderSlots.length) {
            const saved = addMessage(thread.id, {
              role: "assistant",
              content: text,
              renderSlots: renderSlots.length ? renderSlots : undefined,
            });
            setLocalMessages((cur) => [...cur, saved]);
            if (foundryThreadId) setThreadForeignId(thread.id, foundryThreadId);
            onMessagesUpdated();
          }
          return null;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLive(null);
      } finally {
        setIsLoading(false);
      }
    },
    [thread, isLoading, onMessagesUpdated]
  );

  const handleSend = useCallback(() => sendQuery(input), [input, sendQuery]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!thread) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center px-6">
        <BrandLogo size="lg" className="text-primary" />
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Trading IQ</h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-xs leading-relaxed">
            Your AI-powered equity research analyst. Create a new chat to get
            started.
          </p>
        </div>
      </div>
    );
  }

  // Show typing dots only before the first segment arrives. Once segments
  // start populating, the live bubble itself is the affordance.
  const showTyping = isLoading && (!live || live.segments.length === 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <TrendingUp className="h-4 w-4 text-emerald-500" />
        <h2 className="text-sm font-medium truncate max-w-md">
          {thread.title}
        </h2>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 lg:px-16">
        <div className="mx-auto max-w-3xl">
          {localMessages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center gap-5 py-20 text-center">
              <p className="text-sm text-muted-foreground">
                Ask me about any stock or company to get a structured analyst
                brief.
              </p>
              <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendQuery(s)}
                    className="flex flex-col items-start gap-1 rounded-xl border border-border bg-card px-4 py-3 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
                  >
                    <BarChart2 className="h-3.5 w-3.5 text-muted-foreground/70" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {localMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {live && <LiveAssistantBubble live={live} />}

          {showTyping && <TypingIndicator />}

          {error && (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background px-4 py-4 md:px-8 lg:px-16">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a stock, e.g. 'AAPL fundamentals'…"
              rows={1}
              className={cn(
                "min-h-[44px] max-h-40 resize-none rounded-xl pr-2 py-3 text-sm leading-relaxed",
                "focus-visible:ring-1 focus-visible:ring-primary"
              )}
              disabled={isLoading}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Press{" "}
          <kbd className="rounded border border-border px-1 text-xs font-mono">
            Enter
          </kbd>{" "}
          to send &middot;{" "}
          <kbd className="rounded border border-border px-1 text-xs font-mono">
            Shift+Enter
          </kbd>{" "}
          for new line
        </p>
      </div>
    </div>
  );
}
