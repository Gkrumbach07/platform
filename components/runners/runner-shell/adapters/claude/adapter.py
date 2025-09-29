import asyncio
import uuid
from typing import AsyncIterator, Dict, Any

from ...core.context import RunnerContext


class ClaudeAdapter:
    async def on_init(self, ctx: RunnerContext) -> None:
        return None

    async def on_input(self, ctx: RunnerContext, message: Dict[str, Any]) -> None:
        # Handle backend commands if any (noop for now)
        return None

    async def on_tick(self, ctx: RunnerContext) -> None:
        return None

    async def on_cancel(self, ctx: RunnerContext, reason: str) -> None:
        return None

    async def on_shutdown(self, ctx: RunnerContext) -> None:
        return None

    async def get_outbound_messages(self, ctx: RunnerContext) -> AsyncIterator[Dict[str, Any]]:
        # Emit a status and then periodic heartbeats as a minimal proof
        seq = 1
        yield {
            "id": str(uuid.uuid4()),
            "sessionId": ctx.session_id,
            "ts": asyncio.get_event_loop().time().__str__(),
            "type": "status",
            "level": "info",
            "seq": seq,
            "payload": {"phase": "running", "progress": 0},
        }
        seq += 1
        # Heartbeats every 10s
        while True:
            await asyncio.sleep(10)
            yield {
                "id": str(uuid.uuid4()),
                "sessionId": ctx.session_id,
                "ts": asyncio.get_event_loop().time().__str__(),
                "type": "heartbeat",
                "level": "info",
                "seq": seq,
                "payload": {},
            }
            seq += 1
