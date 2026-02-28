"""
ADK-specific instruction construction.

Builds the agent instruction by reusing the platform workspace context
prompt and prepending an ADK-specific preamble.
"""

import logging
import os

from ambient_runner.platform.config import get_repos_config, load_ambient_config
from ambient_runner.platform.prompts import build_workspace_context_prompt

logger = logging.getLogger(__name__)


def build_adk_instruction(workspace_path: str, cwd_path: str) -> str:
    """Build the full instruction string for the ADK LlmAgent.

    Combines an ADK preamble with the platform workspace context prompt.
    """
    repos_cfg = get_repos_config()
    active_workflow_url = (os.getenv("ACTIVE_WORKFLOW_GIT_URL") or "").strip()
    ambient_config = load_ambient_config(cwd_path) if active_workflow_url else {}

    derived_name = None
    if active_workflow_url:
        derived_name = active_workflow_url.split("/")[-1].removesuffix(".git")

    workspace_prompt = build_workspace_context_prompt(
        repos_cfg=repos_cfg,
        workflow_name=derived_name if active_workflow_url else None,
        artifacts_path="artifacts",
        ambient_config=ambient_config,
        workspace_path=workspace_path,
    )

    preamble = (
        "You are a helpful coding assistant running inside the Ambient Code "
        "Platform. You have full filesystem access to the workspace and can "
        "use tools to read, write, and execute commands.\n\n"
    )

    return preamble + workspace_prompt
