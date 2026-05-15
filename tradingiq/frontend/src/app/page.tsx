"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";
import {
  Thread,
  createThread,
  getThreads,
  getThread,
  getActiveThreadId,
  setActiveThreadId,
  deleteThread,
} from "@/lib/threads";

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThread] = useState<string | null>(null);
  const [activeThread, setActiveThreadObj] = useState<Thread | null>(null);

  const refreshThreads = useCallback(() => {
    const all = getThreads();
    setThreads(all);
    // Refresh active thread object
    if (activeThreadId) {
      const t = getThread(activeThreadId);
      setActiveThreadObj(t ?? null);
    }
  }, [activeThreadId]);

  // Initial Load
  useEffect(() => {
    const all = getThreads();
    setThreads(all);
    const savedId = getActiveThreadId();
    if (savedId && all.find((t) => t.id === savedId)) {
      setActiveThread(savedId);
      setActiveThreadObj(getThread(savedId) ?? null);
    }
  }, []);

  const handleNewChat = useCallback(() => {
    const thread = createThread();
    setThreads(getThreads());
    setActiveThread(thread.id);
    setActiveThreadObj(thread);
  }, []);

  const handleSelectThread = useCallback((id: string) => {
    setActiveThreadId(id);
    setActiveThread(id);
    setActiveThreadObj(getThread(id) ?? null);
  }, []);

  const handleDeleteThread = useCallback((id: string) => {
    deleteThread(id);
    const remaining = getThreads();
    setThreads(remaining);
    // If the deleted thread was active, fall back to the most recent remaining one
    if (activeThreadId === id) {
      const next = remaining[0] ?? null;
      setActiveThread(next?.id ?? null);
      setActiveThreadObj(next);
    }
  }, [activeThreadId]);

  const handleMessagesUpdated = useCallback(() => {
    refreshThreads();
  }, [refreshThreads]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onNewChat={handleNewChat}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <ChatArea
          key={activeThreadId ?? "empty"}
          thread={activeThread}
          onMessagesUpdated={handleMessagesUpdated}
        />
      </main>
    </div>
  );
}
