"""Codex-specific authentication — API key setup."""

import logging
import os

from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)

DEFAULT_CODEX_MODEL = "gpt-5.1-codex"


async def setup_codex_auth(context: RunnerContext) -> str:
    """Set up authentication for the Codex SDK.

    Validates the CODEX_API_KEY environment variable and resolves
    the model to use.

    Returns:
        The configured model name.

    Raises:
        RuntimeError: If CODEX_API_KEY is not set.
    """
    api_key = os.getenv("CODEX_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "CODEX_API_KEY not set. Configure it in project settings."
        )

    model = os.getenv("LLM_MODEL", DEFAULT_CODEX_MODEL).strip()
    logger.info("Codex auth configured (model=%s)", model)
    return model
