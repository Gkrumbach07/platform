"""
Codex-specific authentication — OpenAI API key setup.

Validates that the required OPENAI_API_KEY is present and resolves
the model name from environment or defaults.
"""

import logging
import os

from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)

DEFAULT_CODEX_MODEL = "gpt-5.1-codex"


async def setup_codex_auth(context: RunnerContext) -> str:
    """Set up authentication for the Codex SDK.

    Validates the OPENAI_API_KEY environment variable and resolves
    the model to use.

    Args:
        context: Runner context with environment variables.

    Returns:
        The configured model name.

    Raises:
        RuntimeError: If OPENAI_API_KEY is not set.
    """
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    model = os.getenv("LLM_MODEL", DEFAULT_CODEX_MODEL).strip()
    logger.info(f"Codex auth configured (model={model})")
    return model
