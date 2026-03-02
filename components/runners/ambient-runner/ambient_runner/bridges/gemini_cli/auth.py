"""Gemini CLI authentication — API key and model setup."""

import logging
import os

from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)


async def setup_gemini_cli_auth(context: RunnerContext) -> tuple[str, str]:
    """Set up Gemini CLI authentication from environment.

    Returns:
        (model, api_key)
    """
    from ag_ui_gemini_cli.config import DEFAULT_MODEL

    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    model = context.get_env("LLM_MODEL", DEFAULT_MODEL).strip()

    if api_key:
        logger.info("Gemini CLI: using GOOGLE_API_KEY (model=%s)", model)
    else:
        logger.info(
            "Gemini CLI: no GOOGLE_API_KEY set, relying on default gcloud auth (model=%s)",
            model,
        )

    return model, api_key
