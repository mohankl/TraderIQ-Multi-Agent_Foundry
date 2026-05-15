import { v4 as uuidv4 } from "uuid";

export interface ChartPoint {
  t: string; // ISO date YYYY-MM-DD
  c: number; // close
}

export interface ChartStats {
  start: number;
  end: number;
  high: number;
  low: number;
  pct_change: number;
}

/** Provenance fields attached to every render payload by the FastAPI
 * extractor (source_tool_call_id) and the MCP tool (as_of). Both optional. */
export interface RenderPayloadProvenance {
  /** Foundry/MCP tool-call id (e.g. "mcp_abc123") that produced this data. */
  source_tool_call_id?: string | null;
  /** ISO-8601 timestamp from the upstream data provider (e.g. last quote time). */
  as_of?: string | null;
}

export interface ChartRenderPayload extends RenderPayloadProvenance {
  kind: "chart";
  chartType: "line";
  ticker: string;
  period: string;
  points: ChartPoint[];
  stats: ChartStats;
}

export interface StockCardRenderPayload extends RenderPayloadProvenance {
  kind: "stock_card";
  ticker: string;
  name?: string | null;
  exchange?: string | null;
  sector?: string | null;
  price: number;
  previous_close?: number | null;
  change?: number | null;
  change_pct?: number | null;
  market_cap?: number | null;
  market_cap_tier?: string | null;
  pe_ratio?: number | null;
  dividend_yield?: number | null;
  return_on_equity?: number | null;
  revenue_growth?: number | null;
  volume?: number | null;
  fifty_two_week_high?: number | null;
  fifty_two_week_low?: number | null;
}

/** Discriminated union for agent-driven inline UI. Add new `kind`s as the
 * agent gains new tools that produce structured outputs. */
export type RenderPayload = ChartRenderPayload | StockCardRenderPayload;

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** Inline UI components emitted by the agent (e.g. charts). Rendered after
   * the text in the same message bubble. */
  renderSlots?: RenderPayload[];
}

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  /** Foundry response_id for conversation continuity. Set after the first run. */
  foreignId?: string;
}

const STORAGE_KEY = "tradingiq_threads";
const ACTIVE_KEY = "tradingiq_active_thread";

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
  // Drop empty renderSlots so localStorage stays clean.
  if (newMsg.renderSlots && newMsg.renderSlots.length === 0) {
    delete newMsg.renderSlots;
  }
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

export function setThreadForeignId(threadId: string, foreignId: string): void {
  const threads = load();
  const idx = threads.findIndex((t) => t.id === threadId);
  if (idx === -1) return;
  threads[idx].foreignId = foreignId;
  save(threads);
}

export function getActiveThreadId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}
