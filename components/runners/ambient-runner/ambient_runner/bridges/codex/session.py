"""
Codex session management.

Manages Codex SDK client and thread instances. The Codex SDK has native
thread persistence, so no subprocess management is needed — the SDK
handles conversation state internally.
"""

import logging
from typing import Any, AsyncIterator, Dict

logger = logging.getLogger(__name__)


class CodexSessionManager:
    """Manages Codex SDK threads keyed by thread ID.

    Lazily initialises the Codex client on first use to avoid import
    errors when the SDK is not installed.
    """

    def __init__(self) -> None:
        self._codex: Any = None
        self._threads: Dict[str, Any] = {}

    def _ensure_client(self) -> None:
        """Lazily create the Codex client."""
        if self._codex is not None:
            return
        try:
            from openai_codex_sdk import Codex

            self._codex = Codex()
            logger.info("[CodexSessionManager] Codex client initialised")
        except ImportError:
            raise RuntimeError(
                "openai-codex-sdk is not installed. "
                "Install it with: pip install openai-codex-sdk"
            )

    async def get_or_create_thread(self, thread_id: str, config: Dict[str, Any]) -> Any:
        """Return an existing thread or create a new one.

        Args:
            thread_id: Unique identifier for the thread.
            config: Configuration dict with optional keys:
                - cwd: Working directory for the Codex session.

        Returns:
            The Codex thread object.
        """
        if thread_id in self._threads:
            return self._threads[thread_id]

        self._ensure_client()

        thread = self._codex.start_thread(
            config={
                "working_directory": config.get("cwd", "/workspace"),
                "skip_git_repo_check": True,
            }
        )
        self._threads[thread_id] = thread
        logger.info(
            f"[CodexSessionManager] Created thread for {thread_id} "
            f"(cwd={config.get('cwd', '/workspace')})"
        )
        return thread

    async def query(
        self, thread_id: str, prompt: str, config: Dict[str, Any]
    ) -> AsyncIterator[Any]:
        """Run a prompt on the Codex thread and yield events.

        Args:
            thread_id: Thread identifier.
            prompt: User prompt to send.
            config: Session configuration (passed to get_or_create_thread).

        Yields:
            Codex SDK events from the streamed response.
        """
        thread = await self.get_or_create_thread(thread_id, config)
        streamed = await thread.run_streamed(prompt)
        async for event in streamed.events:
            yield event

    async def shutdown(self) -> None:
        """Clean up all threads and release the client."""
        thread_count = len(self._threads)
        self._threads.clear()
        self._codex = None
        logger.info(
            f"[CodexSessionManager] Shutdown complete ({thread_count} threads cleared)"
        )
