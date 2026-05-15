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
import { Button } from "@/components/ui/button";
import { TrendingUp, Send, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

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
  /** AG-UI CUSTOM event fields */
  name?: string;
  value?: unknown;
}

function isRenderPayload(value: unknown): value is RenderPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as { kind?: unknown };
  return v.kind === "chart";
}

export function ChatArea({ thread, onMessagesUpdated }: ChatAreaProps) {
  const [localMessages, setLocalMessages] = useState<Message[]>(
    thread?.messages ?? []
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgCountRef = useRef(0);

  // Sync local messages when thread changes
  useEffect(() => {
    setLocalMessages(thread?.messages ?? []);
    setError(null);
    setInput("");
    msgCountRef.current = thread?.messages.length ?? 0;
  }, [thread?.id]);

  // Scroll to bottom on new message or loading start
  useEffect(() => {
    const isNewMessage = localMessages.length > msgCountRef.current;
    if (isNewMessage || isLoading) {
      msgCountRef.current = localMessages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [localMessages, isLoading]);

  const sendQuery = useCallback(
    async (query: string) => {
      if (!query.trim() || !thread || isLoading) return;

      setInput("");
      setError(null);
      setIsLoading(true);

      // Persist user message locally
      const userMsg = addMessage(thread.id, { role: "user", content: query });
      setLocalMessages((prev) => [...prev, userMsg]);
      onMessagesUpdated();

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
        let assistantContent = "";
        let foundryThreadId: string | undefined;
        const renderSlots: RenderPayload[] = [];

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
                assistantContent += event.delta;
              } else if (event.type === "RUN_FINISHED" && event.threadId) {
                foundryThreadId = event.threadId;
              } else if (event.type === "RUN_ERROR") {
                throw new Error(event.message ?? "Run error");
              } else if (event.type === "CUSTOM" && event.name === "ui.render") {
                if (isRenderPayload(event.value)) {
                  renderSlots.push(event.value);
                } else {
                  console.warn("Ignoring ui.render with unknown payload", event.value);
                }
              }
            } catch (parseErr) {
              console.warn("SSE parse failed", parseErr, line);
            }
          }
        }

        if ((assistantContent || renderSlots.length) && thread) {
          const saved = addMessage(thread.id, {
            role: "assistant",
            content: assistantContent,
            renderSlots: renderSlots.length ? renderSlots : undefined,
          });
          setLocalMessages((prev) => [...prev, saved]);
          if (foundryThreadId) setThreadForeignId(thread.id, foundryThreadId);
          onMessagesUpdated();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
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

  /* ── No thread selected: landing screen ── */
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

  /* ── Active thread ── */
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <TrendingUp className="h-4 w-4 text-emerald-500" />
        <h2 className="text-sm font-medium truncate max-w-md">
          {thread.title}
        </h2>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 lg:px-16">
        <div className="mx-auto max-w-3xl">
          {/* Empty state with suggestion chips */}
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

          {isLoading && <TypingIndicator />}

          {error && (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input Bar */}
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
