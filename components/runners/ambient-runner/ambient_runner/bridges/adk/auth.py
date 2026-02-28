"""
ADK-specific authentication — Google API key and Vertex AI setup.

Two auth modes:
- ``GOOGLE_API_KEY`` env var for direct Gemini API access
- ``GOOGLE_APPLICATION_CREDENTIALS`` for Vertex AI / service account auth

Model selection via ``LLM_MODEL`` env var (default: ``gemini-2.5-flash``).
"""

import logging
import os
from pathlib import Path

from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-2.5-flash"


async def setup_adk_authentication(
    context: RunnerContext,
) -> tuple[str, bool]:
    """Set up authentication for Google ADK.

    Checks for ``GOOGLE_API_KEY`` (direct Gemini) or
    ``GOOGLE_APPLICATION_CREDENTIALS`` (Vertex AI) and resolves the model.

    Returns:
        (configured_model, use_vertex)

    Raises:
        RuntimeError: If neither auth mode is configured.
    """
    api_key = context.get_env("GOOGLE_API_KEY", "").strip()
    sa_path = context.get_env("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    model = context.get_env("LLM_MODEL", "").strip() or DEFAULT_MODEL

    if api_key:
        os.environ["GOOGLE_API_KEY"] = api_key
        logger.info(f"Using Google API key authentication (model={model})")
        return model, False

    if sa_path:
        if not Path(sa_path).exists():
            raise RuntimeError(f"Service account key file not found at {sa_path}")
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = sa_path
        project_id = context.get_env("GOOGLE_CLOUD_PROJECT", "").strip()
        region = context.get_env("GOOGLE_CLOUD_REGION", "").strip()
        logger.info(
            f"Using Vertex AI authentication "
            f"(model={model}, project={project_id}, region={region})"
        )
        return model, True

    raise RuntimeError(
        "Either GOOGLE_API_KEY or GOOGLE_APPLICATION_CREDENTIALS must be set "
        "for the Google ADK bridge"
    )
