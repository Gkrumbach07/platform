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

            # Codex SDK sets CODEX_API_KEY in the subprocess env.
            # Read from OPENAI_API_KEY (our secret) or CODEX_API_KEY.
            import os

            api_key = os.getenv("CODEX_API_KEY", "")
            self._codex = Codex({"api_key": api_key} if api_key else None)
            logger.info("[CodexSessionManager] Codex client initialised (api_key=%s)", "set" if api_key else "unset")
        except ImportError:
            raise RuntimeError(
                "openai-codex-sdk is not installed. "
                "Install it with: pip install openai-codex-sdk"
            )

    async def get_or_create_thread(
        self, thread_id: str, cwd: str = "/workspace", model: str = ""
    ) -> Any:
        """Return an existing thread or create a new one."""
        if thread_id in self._threads:
            return self._threads[thread_id]

        self._ensure_client()

        options = {
            "working_directory": cwd,
            "skip_git_repo_check": True,
            "approval_policy": "never",
            "sandbox_mode": "workspace-write",
        }
        if model:
            options["model"] = model

        thread = self._codex.start_thread(options=options)
        self._threads[thread_id] = thread
        logger.info(
            "[CodexSessionManager] Created thread for %s (cwd=%s, model=%s)",
            thread_id,
            cwd,
            model or "default",
        )
        return thread

    async def query(
        self, thread_id: str, prompt: str, cwd: str = "/workspace", model: str = ""
    ) -> AsyncIterator[Any]:
        """Run a prompt on the Codex thread and yield events."""
        thread = await self.get_or_create_thread(thread_id, cwd=cwd, model=model)
        streamed = await thread.run_streamed(prompt)
        async for event in streamed.events:
            yield event

    async def shutdown(self) -> None:
        """Clean up all threads and release the client."""
        thread_count = len(self._threads)
        self._threads.clear()
        self._codex = None
        logger.info(
            "[CodexSessionManager] Shutdown complete (%d threads cleared)",
            thread_count,
        )
