"""Gemini CLI authentication — API key and Vertex AI setup."""

import logging
import os

from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)


async def setup_gemini_cli_auth(context: RunnerContext) -> tuple[str, str, bool]:
    """Set up Gemini CLI authentication from environment.

    Supports two modes (matching Claude's CLAUDE_CODE_USE_VERTEX pattern):

    1. **API key** (default): Uses GEMINI_API_KEY or GOOGLE_API_KEY.
    2. **Vertex AI**: When GEMINI_USE_VERTEX=1, uses Google Cloud service
       account via GOOGLE_APPLICATION_CREDENTIALS. Requires
       GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION to be set.

    Returns:
        (model, api_key, use_vertex)
    """
    from ag_ui_gemini_cli.config import DEFAULT_MODEL

    model = context.get_env("LLM_MODEL", DEFAULT_MODEL).strip()
    use_vertex = os.getenv("GEMINI_USE_VERTEX", "").strip() == "1"

    if use_vertex:
        # Vertex AI mode — authenticate via service account / ADC
        project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "").strip()
        sa_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()

        if not project:
            raise RuntimeError(
                "GEMINI_USE_VERTEX=1 but GOOGLE_CLOUD_PROJECT is not set"
            )

        logger.info(
            "Gemini CLI: Vertex AI mode (project=%s, location=%s, model=%s, sa=%s)",
            project,
            location or "default",
            model,
            "set" if sa_path else "ADC",
        )
        # Return empty api_key — Gemini CLI will use ADC/service account
        return model, "", True

    # API key mode
    api_key = (
        os.getenv("GEMINI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
    )

    if api_key:
        logger.info("Gemini CLI: using API key (model=%s)", model)
    else:
        logger.info(
            "Gemini CLI: no API key set, relying on default gcloud auth (model=%s)",
            model,
        )

    return model, api_key, False
