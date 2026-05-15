import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const finbotAgent = new HttpAgent({
  url: process.env.FINBOT_API_URL
    ? `${process.env.FINBOT_API_URL}/agui`
    : "http://localhost:8000/agui",
});

const runtime = new CopilotRuntime({
  agents: { finbotAgent },
});

// Multi-route handler for thread operations (GET /threads, etc.)
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit/run",
});

export const GET = handler;
export const POST = handler;
