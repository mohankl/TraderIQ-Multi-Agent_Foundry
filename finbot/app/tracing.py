"""OpenTelemetry tracing bootstrap.

Everything is best-effort: if no OTLP endpoint is configured, the tracer
provider still exists but spans are no-ops, so the rest of the codebase can
call `tracer.start_as_current_span(...)` unconditionally.

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318` (or any HTTP OTLP
target) and optionally `OTEL_EXPORTER_OTLP_HEADERS=key=value,...` to ship
traces. Service name defaults to `finbot-api`; override with
`OTEL_SERVICE_NAME`.
"""

import logging
import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = logging.getLogger(__name__)
_initialized = False


def init_tracing() -> trace.Tracer:
    """Idempotent. Returns a tracer regardless of exporter state."""
    global _initialized
    if not _initialized:
        service_name = os.environ.get("OTEL_SERVICE_NAME", "finbot-api")
        resource = Resource.create({SERVICE_NAME: service_name})
        provider = TracerProvider(resource=resource)

        endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        if endpoint:
            try:
                provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
                logger.info("OTLP exporter enabled (endpoint=%s)", endpoint)
            except Exception as exc:  # pragma: no cover
                logger.warning("OTLP exporter init failed: %s", exc)
        else:
            logger.info("OTEL_EXPORTER_OTLP_ENDPOINT not set; tracing is no-op")

        trace.set_tracer_provider(provider)
        _initialized = True

    return trace.get_tracer("finbot")


def instrument_app(app) -> None:
    """Auto-instrument FastAPI + outbound HTTP calls.

    HTTPX is what the Azure/OpenAI SDK uses under the hood, so this gives us
    one span per Foundry call essentially for free.
    """
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    FastAPIInstrumentor.instrument_app(app)
    HTTPXClientInstrumentor().instrument()
