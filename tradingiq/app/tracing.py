"""OpenTelemetry tracing — Azure AI Foundry edition.

The Foundry portal's Tracing UI reads spans out of the Application Insights
resource that's been attached to the project. So tracing here means:

1. Ask the Foundry project (via its managed-identity SDK call) for the
   connection string of the attached App Insights resource.
2. Hand that connection string to `configure_azure_monitor` — Microsoft's
   one-call helper that installs the tracer provider, the App Insights
   exporter, and auto-instrumentation for FastAPI/httpx/etc.
3. Turn on the Foundry SDK's GenAI auto-instrumentation so every
   `openai.responses.create` call we make through `project.get_openai_client()`
   gets a span with `gen_ai.*` attributes that the Foundry UI knows how to
   render.

Two important env vars (set on `tradingiq-api` Container App):
  - AZURE_EXPERIMENTAL_ENABLE_GENAI_TRACING=true (required before instrument())
  - OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true (prompts+outputs
    captured in spans; user opted into this — see CLAUDE.md "Observability")

If the project is *not* attached to an App Insights resource (or we lack
RBAC), this module falls back to a no-op tracer so the app still boots.
"""

import logging
import os

from opentelemetry import trace

logger = logging.getLogger(__name__)
_initialized = False


def init_tracing() -> trace.Tracer:
    """Idempotent. Returns a tracer regardless of whether shipping worked."""
    global _initialized
    if _initialized:
        return trace.get_tracer("tradingiq")

    # GenAI auto-instrumentation refuses to attach unless this is set BEFORE
    # AIProjectInstrumentor().instrument() runs. Set it defensively here so
    # nobody can forget the env var on the Container App.
    os.environ.setdefault("AZURE_EXPERIMENTAL_ENABLE_GENAI_TRACING", "true")

    try:
        from azure.ai.projects import AIProjectClient
        from azure.ai.projects.telemetry import AIProjectInstrumentor
        from azure.identity import DefaultAzureCredential
        from azure.monitor.opentelemetry import configure_azure_monitor

        endpoint = os.environ.get("AZURE_EXISTING_AIPROJECT_ENDPOINT")
        if not endpoint:
            logger.warning("AZURE_EXISTING_AIPROJECT_ENDPOINT not set; tracing disabled")
            _initialized = True
            return trace.get_tracer("tradingiq")

        credential = DefaultAzureCredential()
        project = AIProjectClient(endpoint=endpoint, credential=credential)
        connection_string = project.telemetry.get_application_insights_connection_string()

        if not connection_string:
            logger.warning(
                "Foundry project has no Application Insights attached; tracing is no-op"
            )
            _initialized = True
            return trace.get_tracer("tradingiq")

        # One call installs: TracerProvider, BatchSpanProcessor, App Insights
        # exporter, and FastAPI/httpx/requests/urllib3/logging auto-instrumentation.
        configure_azure_monitor(
            connection_string=connection_string,
            disable_offline_storage=False,
        )

        # Patches the OpenAI client returned by `project.get_openai_client()`
        # so each responses.create() emits gen_ai.* spans. Must run AFTER the
        # tracer provider is installed.
        AIProjectInstrumentor().instrument()
        logger.info("Foundry tracing enabled (App Insights connection from project SDK)")

    except Exception as exc:  # pragma: no cover — bootstrap failures should not crash the app
        logger.warning("Foundry tracing bootstrap failed: %s", exc)

    _initialized = True
    return trace.get_tracer("tradingiq")


def instrument_app(_app) -> None:
    """No-op. `configure_azure_monitor()` already auto-instruments FastAPI
    and httpx. Kept so main.py's call site doesn't need to change."""
    return
