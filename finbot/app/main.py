import os
import uuid

from ag_ui.core import RunAgentInput
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.agent import run_agent_stream
from app.tracing import init_tracing, instrument_app

_ = load_dotenv()
init_tracing()
app = FastAPI(title="FinBot API")
instrument_app(app)

_raw_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/agui")
async def agui_endpoint(input_data: RunAgentInput):
    """AG-UI compatible SSE streaming endpoint consumed by CopilotKit."""
    thread_id = input_data.thread_id if input_data.thread_id else None
    run_id = input_data.run_id or str(uuid.uuid4())

    # Last user message is the query
    query = ""
    for msg in reversed(input_data.messages):
        if hasattr(msg, "role") and msg.role == "user":
            content = getattr(msg, "content", "")
            query = content if isinstance(content, str) else str(content)
            break

    if not query:
        # agent/connect or empty call — return a minimal valid stream
        from ag_ui.core import EventType, RunFinishedEvent, RunStartedEvent
        from ag_ui.encoder import EventEncoder

        async def _empty_stream():
            enc = EventEncoder()
            yield enc.encode(RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id or "", run_id=run_id))
            yield enc.encode(RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=thread_id or "", run_id=run_id))

        return StreamingResponse(
            _empty_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return StreamingResponse(
        run_agent_stream(query, thread_id, run_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
