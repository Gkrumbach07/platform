from typing import AsyncIterator, Dict, Any
from ..core.context import RunnerContext


class RunnerAdapter:
    async def on_init(self, ctx: RunnerContext) -> None:  # pragma: no cover
        return None

    async def on_input(self, ctx: RunnerContext, message: Dict[str, Any]) -> None:  # pragma: no cover
        return None

    async def on_tick(self, ctx: RunnerContext) -> None:  # pragma: no cover
        return None

    async def on_cancel(self, ctx: RunnerContext, reason: str) -> None:  # pragma: no cover
        return None

    async def on_shutdown(self, ctx: RunnerContext) -> None:  # pragma: no cover
        return None

    async def get_outbound_messages(self, ctx: RunnerContext) -> AsyncIterator[Dict[str, Any]]:  # pragma: no cover
        if False:
            yield {}

