"""
ADK agent factory — creates and configures the Google ADK LlmAgent.

Builds an ``LlmAgent`` with the resolved model, platform instruction,
AG-UI toolset, and optional observability tools (rubric, corrections).
Wraps it in an ``ADKAgent`` middleware for AG-UI event streaming.
"""

import logging
import os
from typing import Any

from ag_ui_adk import ADKAgent, AGUIToolset
from google.adk.agents import LlmAgent

from ambient_runner.bridges.adk.prompts import build_adk_instruction
from ambient_runner.bridges.adk.file_tools import get_all_file_tools
from ambient_runner.bridges.adk.tools import (
    create_corrections_tool,
    create_refresh_credentials_tool,
    create_restart_session_tool,
    create_rubric_tool,
)
from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)


def create_adk_agent(
    context: RunnerContext,
    model: str,
    cwd_path: str,
    obs: Any = None,
) -> ADKAgent:
    """Create a fully configured ADKAgent for the Ambient platform.

    Args:
        context: RunnerContext with session info and environment.
        model: Resolved Gemini model name (e.g. ``gemini-2.5-flash``).
        cwd_path: Working directory for the agent.
        obs: Optional ObservabilityManager instance.

    Returns:
        An ``ADKAgent`` middleware instance ready to process ``RunAgentInput``.
    """
    workspace_path = context.workspace_path or "/workspace"

    # Build instruction
    instruction = build_adk_instruction(workspace_path, cwd_path)

    # Collect tools
    tools: list = [AGUIToolset()]

    # File system + bash tools
    tools.extend(get_all_file_tools())

    # Platform tools (always available)
    tools.append(create_restart_session_tool(context))
    tools.append(create_refresh_credentials_tool(context))

    # Observability tools (only when Langfuse is configured)
    rubric_tool = create_rubric_tool(context, obs)
    if rubric_tool is not None:
        tools.append(rubric_tool)
        logger.info("ADK agent: rubric evaluation tool enabled")

    corrections_tool = create_corrections_tool(context, obs)
    if corrections_tool is not None:
        tools.append(corrections_tool)
        logger.info("ADK agent: corrections tool enabled")

    # Create the LlmAgent
    llm_agent = LlmAgent(
        name="ambient_assistant",
        model=model,
        description="Ambient Code Platform assistant powered by Google ADK",
        instruction=instruction,
        tools=tools,
    )

    logger.info(f"Created LlmAgent: model={model}, tools={len(tools)}, cwd={cwd_path}")

    # Wrap in ADKAgent middleware for AG-UI event streaming
    user_id = os.getenv("USER_ID", "ambient-user").strip()
    adk_agent = ADKAgent(
        adk_agent=llm_agent,
        app_name="ambient-runner",
        user_id=user_id,
    )

    return adk_agent
