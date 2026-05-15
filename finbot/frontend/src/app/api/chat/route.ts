import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

const FINBOT_URL = process.env.FINBOT_API_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  const { threadId, messageId, content } = await req.json();

  const payload = {
    threadId: threadId ?? randomUUID(),
    runId: randomUUID(),
    messages: [
      {
        id: messageId ?? randomUUID(),
        role: "user",
        content,
      },
    ],
    tools: [],
    context: [],
    forwardedProps: {},
    state: {},
  };

  const upstream = await fetch(`${FINBOT_URL}/agui`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
