"""
ADKBridge — full-lifecycle PlatformBridge for Google ADK.

Owns the entire ADK session lifecycle:
- Platform setup (auth, workspace, observability)
- ADKAgent creation and caching
- Tracing middleware integration
- Interrupt and graceful shutdown
"""

import logging
import os
import time
from typing import Any, AsyncIterator, Optional

from ag_ui.core import BaseEvent, RunAgentInput

from ambient_runner.bridge import FrameworkCapabilities, PlatformBridge
from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)

# Minimum seconds between credential refreshes
_CREDS_REFRESH_INTERVAL_SEC = 60


class ADKBridge(PlatformBridge):
    """Bridge between the Ambient platform and Google ADK.

    Handles lazy platform initialisation on first ``run()`` call, builds
    and caches the ``ADKAgent``, and wraps the event stream with
    Langfuse tracing.
    """

    def __init__(self) -> None:
        self._adk_agent: Any = None
        self._obs: Any = None
        self._context: RunnerContext | None = None

        # Platform state (populated by _setup_platform)
        self._ready: bool = False
        self._configured_model: str = ""
        self._cwd_path: str = ""
        self._last_creds_refresh: float = 0.0

    # ------------------------------------------------------------------
    # PlatformBridge interface
    # ------------------------------------------------------------------

    def capabilities(self) -> FrameworkCapabilities:
        has_tracing = (
            self._obs is not None
            and hasattr(self._obs, "langfuse_client")
            and self._obs.langfuse_client is not None
        )
        return FrameworkCapabilities(
            framework="google-adk",
            agent_features=[
                "agentic_chat",
                "backend_tool_rendering",
                "shared_state",
            ],
            file_system=True,
            mcp=True,
            tracing="langfuse" if has_tracing else None,
            session_persistence=False,
        )

    async def run(self, input_data: RunAgentInput) -> AsyncIterator[BaseEvent]:
        """Full run lifecycle: lazy setup -> agent -> tracing."""
        # 1. Lazy platform setup
        await self._ensure_ready()

        # Refresh credentials if stale
        now = time.monotonic()
        if now - self._last_creds_refresh > _CREDS_REFRESH_INTERVAL_SEC:
            from ambient_runner.platform.auth import populate_runtime_credentials

            await populate_runtime_credentials(self._context)
            self._last_creds_refresh = now

        # 2. Ensure agent exists
        self._ensure_agent()

        # 3. Extract user message for observability
        user_msg = ""
        if input_data.messages:
            last = input_data.messages[-1]
            if hasattr(last, "content"):
                user_msg = str(last.content) if last.content else ""

        # 4. Run agent with tracing middleware
        from ambient_runner.middleware import tracing_middleware

        raw_stream = self._adk_agent.run(input_data)

        wrapped_stream = tracing_middleware(
            raw_stream,
            obs=self._obs,
            model=self._configured_model,
            prompt=user_msg,
        )

        async for event in wrapped_stream:
            yield event


    async def interrupt(self, thread_id: Optional[str] = None) -> None:
        """Interrupt the running agent.

        ADK does not expose a native interrupt mechanism, so this is a
        best-effort no-op that logs the request.
        """
        logger.warning(
            f"Interrupt requested for ADK bridge (thread={thread_id}). "
            "ADK does not support native interrupt — the current run "
            "will complete naturally."
        )

    # ------------------------------------------------------------------
    # Lifecycle methods
    # ------------------------------------------------------------------

    def set_context(self, context: RunnerContext) -> None:
        """Store the runner context (called from lifespan)."""
        self._context = context

    async def shutdown(self) -> None:
        """Graceful shutdown: finalise tracing."""
        if self._obs:
            await self._obs.finalize()
        logger.info("ADKBridge: shutdown complete")

    def mark_dirty(self) -> None:
        """Signal agent rebuild on next run (repo/workflow change)."""
        self._ready = False
        self._adk_agent = None
        logger.info("ADKBridge: marked dirty — will reinitialise on next run")

    async def get_mcp_status(self) -> dict:
        """Return MCP server status.

        ADK manages its own tool connections; return a minimal status
        indicating the bridge is active.
        """
        if not self._context:
            return {
                "servers": [],
                "totalCount": 0,
                "message": "Context not initialized",
            }
        return {
            "servers": [],
            "totalCount": 0,
            "message": "ADK manages tools internally",
        }

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def context(self) -> RunnerContext | None:
        return self._context

    @property
    def configured_model(self) -> str:
        return self._configured_model

    @property
    def obs(self) -> Any:
        return self._obs

    # ------------------------------------------------------------------
    # Private: platform setup (lazy, called on first run)
    # ------------------------------------------------------------------

    async def _ensure_ready(self) -> None:
        """Run one-time platform setup if not already done."""
        if self._ready:
            return
        if not self._context:
            raise RuntimeError("Context not set — call set_context() first")
        await self._setup_platform()
        self._ready = True
        logger.info(
            f"Platform ready — model: {self._configured_model}, cwd: {self._cwd_path}"
        )

    async def _setup_platform(self) -> None:
        """Full platform setup: auth, workspace, observability."""
        from ambient_runner.bridges.adk.auth import setup_adk_authentication
        from ambient_runner.platform.auth import populate_runtime_credentials
        from ambient_runner.platform.workspace import (
            resolve_workspace_paths,
            validate_prerequisites,
        )

        await validate_prerequisites(self._context)

        # ADK-specific auth
        configured_model, _use_vertex = await setup_adk_authentication(self._context)

        # Populate credentials before building prompt
        await populate_runtime_credentials(self._context)
        self._last_creds_refresh = time.monotonic()

        # Workspace paths
        cwd_path, _add_dirs = resolve_workspace_paths(self._context)

        # Observability (before agent so tools can access it)
        await self._setup_observability(configured_model)

        # Store results
        self._configured_model = configured_model
        self._cwd_path = cwd_path

    async def _setup_observability(self, configured_model: str) -> None:
        """Initialise Langfuse observability (best-effort)."""
        try:
            from ambient_runner.observability import ObservabilityManager
            from ambient_runner.platform.auth import sanitize_user_context

            raw_user_id = os.getenv("USER_ID", "").strip()
            raw_user_name = os.getenv("USER_NAME", "").strip()
            user_id, user_name = sanitize_user_context(raw_user_id, raw_user_name)

            obs = ObservabilityManager(
                session_id=self._context.session_id,
                user_id=user_id,
                user_name=user_name,
            )
            await obs.initialize(
                prompt="(pending)",
                namespace=self._context.get_env("AGENTIC_SESSION_NAMESPACE", "unknown"),
                model=configured_model,
            )
            self._obs = obs
        except Exception as e:
            logger.warning(f"Failed to initialize observability: {e}")

    # ------------------------------------------------------------------
    # Private: agent lifecycle
    # ------------------------------------------------------------------

    def _ensure_agent(self) -> None:
        """Build or reuse the ADKAgent."""
        if self._adk_agent is not None:
            return

        from ambient_runner.bridges.adk.agent import create_adk_agent

        self._adk_agent = create_adk_agent(
            context=self._context,
            model=self._configured_model,
            cwd_path=self._cwd_path,
            obs=self._obs,
        )
        logger.info("ADKAgent built (will be reused across runs)")
