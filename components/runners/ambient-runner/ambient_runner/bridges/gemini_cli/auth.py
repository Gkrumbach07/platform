"""Gemini CLI authentication — API key and Vertex AI setup."""

import logging
import os

from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)


async def setup_gemini_cli_auth(context: RunnerContext) -> tuple[str, str, bool]:
    """Set up Gemini CLI authentication from environment.

    Reuses the same Vertex AI config as Claude Code:
    - CLAUDE_CODE_USE_VERTEX=1 enables Vertex for both Claude and Gemini
    - GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, GOOGLE_APPLICATION_CREDENTIALS
      are shared across both runners (set at operator level)

    Returns:
        (model, api_key, use_vertex)
    """
    from ag_ui_gemini_cli.config import DEFAULT_MODEL

    model = context.get_env("LLM_MODEL", DEFAULT_MODEL).strip()
    use_vertex = os.getenv("CLAUDE_CODE_USE_VERTEX", "").strip() == "1"

    if use_vertex:
        project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "").strip()

        logger.info(
            "Gemini CLI: Vertex AI mode (project=%s, location=%s, model=%s)",
            project or "unset",
            location or "default",
            model,
        )
        return model, "", True

    api_key = (
        os.getenv("GEMINI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
    )

    if api_key:
        logger.info("Gemini CLI: using API key (model=%s)", model)
    else:
        logger.info("Gemini CLI: no API key, relying on gcloud auth (model=%s)", model)

    return model, api_key, False
