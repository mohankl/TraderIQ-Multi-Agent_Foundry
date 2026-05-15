import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const tradingIqAgent = new HttpAgent({
  url: process.env.TRADINGIQ_API_URL
    ? `${process.env.TRADINGIQ_API_URL}/agui`
    : "http://localhost:8000/agui",
});

const runtime = new CopilotRuntime({
  agents: { tradingIqAgent },
});

// Multi-route handler for thread operations (GET /threads, etc.)
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit/run",
});

export const GET = handler;
export const POST = handler;
