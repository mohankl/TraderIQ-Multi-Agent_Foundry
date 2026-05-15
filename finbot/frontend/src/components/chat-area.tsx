"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Thread,
  Message,
  RenderPayload,
  addMessage,
  setThreadForeignId,
} from "@/lib/threads";
import { ChatMessage, TypingIndicator } from "@/components/chat-message";
import { StepPill, type StepState } from "@/components/step-pill";
import { RenderSlot } from "@/components/render-slot";
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

interface AGUIEvent {
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

function isRenderPayload(value: unknown): value is RenderPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as { kind?: unknown };
  return v.kind === "chart" || v.kind === "stock_card";
}

/** Ordered segments that make up the live (in-flight) assistant message.
 * Once the run finishes we flatten this back into `Message.content` +
 * `renderSlots` for persistence. Keeping the segment order in memory is
 * what enables interleaved rendering — a card can appear *before* the text
 * that references it. */
type LiveSegment =
  | { kind: "text"; text: string }
  | { kind: "step"; step: StepState }
  | { kind: "render"; payload: RenderPayload };

interface LiveAssistant {
  segments: LiveSegment[];
}

function appendOrCreateText(segments: LiveSegment[], delta: string): LiveSegment[] {
  const last = segments[segments.length - 1];
  if (last && last.kind === "text") {
    return [
      ...segments.slice(0, -1),
      { kind: "text", text: last.text + delta },
    ];
  }
  return [...segments, { kind: "text", text: delta }];
}

function flattenLive(live: LiveAssistant): { text: string; renderSlots: RenderPayload[] } {
  let text = "";
  const renderSlots: RenderPayload[] = [];
  for (const seg of live.segments) {
    if (seg.kind === "text") text += seg.text;
    else if (seg.kind === "render") renderSlots.push(seg.payload);
  }
  return { text, renderSlots };
}

function LiveAssistantBubble({ live }: { live: LiveAssistant }) {
  return (
    <div className="flex items-start gap-3 py-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <TrendingUp className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm text-foreground shadow-sm">
        {live.segments.map((seg, i) => {
          if (seg.kind === "step") {
            return <StepPill key={i} step={seg.step} />;
          }
          if (seg.kind === "render") {
            return <RenderSlot key={i} payload={seg.payload} />;
          }
          // text
          return (
            <div
              key={i}
              className="prose prose-sm dark:prose-invert max-w-none leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
            </div>
          );
        })}
      </div>
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
  const msgCountRef = useRef(0);

  useEffect(() => {
    setLocalMessages(thread?.messages ?? []);
    setError(null);
    setInput("");
    setLive(null);
    msgCountRef.current = thread?.messages.length ?? 0;
  }, [thread?.id]);

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
              if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
                const delta = event.delta;
                setLive((prev) =>
                  prev
                    ? { segments: appendOrCreateText(prev.segments, delta) }
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
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <TrendingUp className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">FinBot</h2>
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
