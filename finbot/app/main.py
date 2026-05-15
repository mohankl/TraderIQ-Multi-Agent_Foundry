import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agent import run_agent
from app.schemas import BriefRequest, BriefResponse

_ = load_dotenv()
app = FastAPI(title="FinBot API")

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


@app.post("/brief", response_model=BriefResponse)
def brief(payload: BriefRequest):
    result, thread_id = run_agent(payload.query, payload.thread_id)
    return BriefResponse(result=result, thread_id=thread_id)
