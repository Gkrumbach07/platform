"""
ADK platform tools — FunctionTool wrappers for Ambient platform features.

Ports the Claude MCP tools (rubric, corrections, restart, refresh) to
Google ADK ``FunctionTool`` instances.
"""

import logging
import os
import time as _time
from typing import Any

from google.adk.tools import FunctionTool

logger = logging.getLogger(__name__)

_TOOL_REFRESH_MIN_INTERVAL_SEC = 30


# ------------------------------------------------------------------
# Restart session tool
# ------------------------------------------------------------------


def create_restart_session_tool(context: Any) -> FunctionTool:
    """Create a FunctionTool that signals a session restart.

    Args:
        context: RunnerContext instance (used to set restart flag).

    Returns:
        ADK FunctionTool.
    """

    def restart_session(reason: str = "") -> dict:
        """Request a session restart to recover from issues or clear state.

        Args:
            reason: Optional reason for the restart.

        Returns:
            Confirmation message.
        """
        context.set_metadata("restart_requested", True)
        logger.info("Session restart requested via ADK tool")
        return {
            "status": "ok",
            "message": (
                "Session restart has been requested. The current run "
                "will complete and a fresh session will be established."
            ),
        }

    return FunctionTool(func=restart_session)


# ------------------------------------------------------------------
# Credential refresh tool
# ------------------------------------------------------------------


def create_refresh_credentials_tool(context: Any) -> FunctionTool:
    """Create a FunctionTool that refreshes platform credentials.

    Args:
        context: RunnerContext instance.

    Returns:
        ADK FunctionTool.
    """
    last_refresh = [0.0]

    def refresh_credentials() -> dict:
        """Refresh all platform credentials (GitHub, Google, GitLab, Jira).

        Call this if you encounter authentication errors such as 401/403
        responses, expired tokens, or MCP server auth failures.

        Returns:
            Status message with refreshed integrations.
        """
        import asyncio

        now = _time.monotonic()
        if now - last_refresh[0] < _TOOL_REFRESH_MIN_INTERVAL_SEC:
            return {
                "status": "skipped",
                "message": "Credentials were refreshed recently. Try again later.",
            }

        from ambient_runner.platform.auth import populate_runtime_credentials

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(
                        asyncio.run, populate_runtime_credentials(context)
                    )
                    future.result(timeout=15)
            else:
                loop.run_until_complete(populate_runtime_credentials(context))

            last_refresh[0] = _time.monotonic()
            logger.info("Credentials refreshed via ADK tool")

            refreshed = []
            if os.getenv("GITHUB_TOKEN"):
                refreshed.append("GitHub")
            if os.getenv("GITLAB_TOKEN"):
                refreshed.append("GitLab")
            if os.getenv("JIRA_API_TOKEN"):
                refreshed.append("Jira")
            if os.getenv("USER_GOOGLE_EMAIL"):
                refreshed.append("Google")

            summary = ", ".join(refreshed) if refreshed else "none detected"
            return {
                "status": "ok",
                "message": f"Credentials refreshed. Active integrations: {summary}.",
            }
        except Exception:
            logger.error("Credential refresh failed", exc_info=True)
            return {
                "status": "error",
                "message": "Credential refresh failed. Check runner logs.",
            }

    return FunctionTool(func=refresh_credentials)


# ------------------------------------------------------------------
# Rubric evaluation tool
# ------------------------------------------------------------------


def create_rubric_tool(context: Any, obs: Any) -> FunctionTool | None:
    """Create a FunctionTool for rubric-based evaluation.

    Returns None if no rubric content is found.

    Args:
        context: RunnerContext instance.
        obs: ObservabilityManager instance.

    Returns:
        ADK FunctionTool or None.
    """
    from ambient_runner.bridges.claude.tools import load_rubric_content

    workspace_path = context.workspace_path or "/workspace"
    active_workflow_url = os.getenv("ACTIVE_WORKFLOW_GIT_URL", "").strip()
    cwd_path = workspace_path

    if active_workflow_url:
        workflow_name = active_workflow_url.split("/")[-1].removesuffix(".git")
        workflow_path = os.path.join(workspace_path, "workflows", workflow_name)
        if os.path.exists(workflow_path):
            cwd_path = workflow_path

    rubric_content, _rubric_config = load_rubric_content(cwd_path)
    if not rubric_content:
        return None

    _obs = obs
    _session_id = context.session_id

    def evaluate_rubric(
        score: float, comment: str, metadata: dict | None = None
    ) -> dict:
        """Log a rubric evaluation score to Langfuse.

        Read .ambient/rubric.md FIRST, evaluate the output against the
        criteria, then call this tool with your score, comment, and metadata.

        Args:
            score: Overall evaluation score.
            comment: Evaluation reasoning and commentary.
            metadata: Optional structured metadata.

        Returns:
            Status message.
        """
        from ambient_runner.bridges.claude.tools import _log_to_langfuse

        success, error = _log_to_langfuse(
            score=score,
            comment=comment,
            metadata=metadata,
            obs=_obs,
            session_id=_session_id,
        )
        if success:
            return {"status": "ok", "message": f"Score {score} logged to Langfuse."}
        return {"status": "error", "message": f"Failed to log score: {error}"}

    return FunctionTool(func=evaluate_rubric)


# ------------------------------------------------------------------
# Corrections tool
# ------------------------------------------------------------------


def create_corrections_tool(context: Any, obs: Any) -> FunctionTool | None:
    """Create a FunctionTool for logging corrections to Langfuse.

    Returns None if Langfuse is not enabled.

    Args:
        context: RunnerContext instance.
        obs: ObservabilityManager instance.

    Returns:
        ADK FunctionTool or None.
    """
    langfuse_enabled = os.getenv("LANGFUSE_ENABLED", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    if not langfuse_enabled:
        return None

    from ambient_runner.bridges.claude.corrections import (
        _get_session_context,
        _log_correction_to_langfuse,
        build_target_map,
    )

    session_context = _get_session_context()
    _target_map = build_target_map(session_context)
    _obs = obs
    _session_id = context.session_id

    def log_correction(
        correction_type: str,
        agent_action: str,
        user_correction: str,
        target: str = "",
        source: str = "human",
    ) -> dict:
        """Log a correction whenever the user redirects, corrects, or changes what you did.

        Call this BEFORE fixing the issue.

        Args:
            correction_type: One of: incomplete, incorrect, out_of_scope, style.
            agent_action: What you did or assumed (be honest and specific).
            user_correction: What the user said should have happened instead.
            target: Which target this correction applies to.
            source: 'human' (default) or 'rubric'.

        Returns:
            Status message.
        """
        success, error = _log_correction_to_langfuse(
            correction_type=correction_type,
            agent_action=agent_action,
            user_correction=user_correction,
            target_label=target,
            target_map=_target_map,
            obs=_obs,
            session_id=_session_id,
            source=source,
        )
        if success:
            return {
                "status": "ok",
                "message": (
                    f"Correction logged: type={correction_type}. "
                    "This will be reviewed in the next feedback loop cycle."
                ),
            }
        return {"status": "error", "message": f"Failed to log correction: {error}"}

    return FunctionTool(func=log_correction)
