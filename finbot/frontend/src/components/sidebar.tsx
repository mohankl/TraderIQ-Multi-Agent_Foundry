"use client";

import { Thread } from "@/lib/threads";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { MessageSquarePlus, TrendingUp, MessageSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  threads: Thread[];
  activeThreadId: string | null;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
}

export function Sidebar({ threads, activeThreadId, onNewChat, onSelectThread, onDeleteThread }: SidebarProps) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <TrendingUp className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight">FinBot</h1>
          <p className="text-xs text-muted-foreground">Equity Research Agent</p>
        </div>
      </div>

      <Separator />

      {/* New Chat Button */}
      <div className="px-3 py-3">
        <Button
          onClick={onNewChat}
          className="w-full justify-start gap-2"
          variant="default"
          size="sm"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1 px-2">
        {threads.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            No conversations yet
          </p>
        ) : (
          <div className="space-y-0.5 pb-4">
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Recent
            </p>
            {threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  activeThreadId === thread.id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-foreground/70"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1">{thread.title}</span>
                <span
                  role="button"
                  aria-label="Delete thread"
                  onClick={(e) => { e.stopPropagation(); onDeleteThread(thread.id); }}
                  className="ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive group-hover:flex"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
