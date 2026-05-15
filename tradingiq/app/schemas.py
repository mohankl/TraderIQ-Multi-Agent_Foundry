from pydantic import BaseModel


class BriefRequest(BaseModel):
    query: str
    thread_id: str | None = None


class BriefResponse(BaseModel):
    result: str
    thread_id: str
