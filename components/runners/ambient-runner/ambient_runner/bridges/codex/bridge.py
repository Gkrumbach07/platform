"""
CodexBridge — full-lifecycle PlatformBridge for the Codex SDK.

Owns the entire Codex session lifecycle:
- Platform setup (auth, workspace, observability)
- Adapter creation and caching
- Session management (native Codex thread persistence)
- Tracing middleware integration
- Interrupt and graceful shutdown
"""

import logging
import time
from typing import Any, AsyncIterator, Optional

from ag_ui.core import BaseEvent, RunAgentInput
from ag_ui_codex_sdk import CodexAdapter

from ambient_runner.bridge import (
    CREDS_REFRESH_INTERVAL_SEC,
    FrameworkCapabilities,
    PlatformBridge,
    setup_bridge_observability,
)
from ambient_runner.bridges.codex.session import CodexSessionManager
from ambient_runner.platform.context import RunnerContext

logger = logging.getLogger(__name__)


class CodexBridge(PlatformBridge):
    """Bridge between the Ambient platform and the Codex SDK.

    Handles lazy platform initialisation on first ``run()`` call, builds
    and caches the ``CodexAdapter``, manages native Codex threads, and
    wraps the event stream with Langfuse tracing.
    """

    def __init__(self) -> None:
        self._adapter: CodexAdapter | None = None
        self._session_manager: CodexSessionManager | None = None
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
            framework="codex-sdk",
            agent_features=[
                "agentic_chat",
                "backend_tool_rendering",
                "thinking",
            ],
            file_system=True,
            mcp=True,
            tracing="langfuse" if has_tracing else None,
        )

    async def run(self, input_data: RunAgentInput) -> AsyncIterator[BaseEvent]:
        """Full run lifecycle: lazy setup -> adapter -> session -> tracing."""
        # 1. Lazy platform setup
        await self._ensure_ready()

        # Refresh credentials if stale
        now = time.monotonic()
        if now - self._last_creds_refresh > CREDS_REFRESH_INTERVAL_SEC:
            from ambient_runner.platform.auth import populate_runtime_credentials

            await populate_runtime_credentials(self._context)
            self._last_creds_refresh = now

        # 2. Ensure adapter exists
        if self._adapter is None:
            self._adapter = CodexAdapter()

        # 3. Extract user message for observability
        from ag_ui_codex_sdk.utils import extract_user_message

        user_msg = extract_user_message(input_data)

        # 4. Get event stream from Codex thread
        thread_id = input_data.thread_id or self._context.session_id
        config = {"cwd": self._cwd_path}

        event_stream = self._session_manager.query(thread_id, user_msg, config)

        # 5. Run adapter with event stream, wrapped in tracing
        from ambient_runner.middleware import tracing_middleware

        raw_stream = self._adapter.run(input_data, event_stream=event_stream)

        wrapped_stream = tracing_middleware(
            raw_stream,
            obs=self._obs,
            model=self._configured_model,
            prompt=user_msg,
        )

        async for event in wrapped_stream:
            yield event

    async def interrupt(self, thread_id: Optional[str] = None) -> None:
        """Interrupt the running session.

        The Codex SDK does not expose an interrupt API at the thread level,
        so this is a no-op with a warning.
        """
        logger.warning(
            f"Codex SDK does not support thread-level interrupt (thread_id={thread_id})"
        )

    # ------------------------------------------------------------------
    # Lifecycle methods
    # ------------------------------------------------------------------

    def set_context(self, context: RunnerContext) -> None:
        """Store the runner context (called from lifespan)."""
        self._context = context

    async def shutdown(self) -> None:
        """Graceful shutdown: clean up sessions, finalise tracing."""
        if self._session_manager:
            await self._session_manager.shutdown()
        if self._obs:
            await self._obs.finalize()
        logger.info("CodexBridge: shutdown complete")

    def mark_dirty(self) -> None:
        """Signal adapter rebuild on next run."""
        self._ready = False
        self._adapter = None
        if self._session_manager:
            manager = self._session_manager
            self._session_manager = None
            import asyncio

            try:
                asyncio.get_running_loop()
                future = asyncio.ensure_future(manager.shutdown())
                future.add_done_callback(
                    lambda f: logger.warning(
                        "mark_dirty: session_manager shutdown error: %s",
                        f.exception(),
                    )
                    if f.exception()
                    else None
                )
            except RuntimeError:
                try:
                    asyncio.run(manager.shutdown())
                except Exception as e:
                    logger.warning("mark_dirty: session_manager shutdown error: %s", e)
        logger.info("CodexBridge: marked dirty — will reinitialise on next run")

    def get_error_context(self) -> str:
        """Return extra error context (no stderr buffer for Codex)."""
        return ""

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

    @property
    def session_manager(self) -> CodexSessionManager | None:
        return self._session_manager

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
        # Session manager
        if self._session_manager is None:
            self._session_manager = CodexSessionManager()

        # Codex-specific auth
        from ambient_runner.bridges.codex.auth import setup_codex_auth
        from ambient_runner.platform.auth import populate_runtime_credentials
        from ambient_runner.platform.workspace import resolve_workspace_paths

        configured_model = await setup_codex_auth(self._context)

        # Populate credentials before first run
        await populate_runtime_credentials(self._context)
        self._last_creds_refresh = time.monotonic()

        # Workspace paths
        cwd_path, _add_dirs = resolve_workspace_paths(self._context)

        # Observability (shared helper)
        self._obs = await setup_bridge_observability(self._context, configured_model)

        # Store results
        self._configured_model = configured_model
        self._cwd_path = cwd_path
