import { v4 as uuidv4 } from "uuid";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

const STORAGE_KEY = "finbot_threads";
const ACTIVE_KEY = "finbot_active_thread";

function load(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Thread[];
  } catch {
    return [];
  }
}

function save(threads: Thread[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

export function getThreads(): Thread[] {
  return load().sort((a, b) => b.createdAt - a.createdAt);
}

export function getThread(id: string): Thread | undefined {
  return load().find((t) => t.id === id);
}

export function createThread(): Thread {
  const thread: Thread = {
    id: uuidv4(),
    title: "New Chat",
    messages: [],
    createdAt: Date.now(),
  };
  const threads = load();
  threads.push(thread);
  save(threads);
  setActiveThreadId(thread.id);
  return thread;
}

export function addMessage(threadId: string, message: Omit<Message, "id" | "createdAt">): Message {
  const threads = load();
  const idx = threads.findIndex((t) => t.id === threadId);
  if (idx === -1) throw new Error(`Thread ${threadId} not found`);

  const newMsg: Message = { ...message, id: uuidv4(), createdAt: Date.now() };
  threads[idx].messages.push(newMsg);

  // Auto-title from first user message
  if (threads[idx].title === "New Chat" && message.role === "user") {
    threads[idx].title = message.content.slice(0, 50);
  }

  save(threads);
  return newMsg;
}

export function deleteThread(id: string): void {
  const threads = load().filter((t) => t.id !== id);
  save(threads);
  if (localStorage.getItem(ACTIVE_KEY) === id) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function setActiveThreadId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveThreadId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}
