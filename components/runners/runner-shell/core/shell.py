import asyncio
import json
import uuid
from typing import Dict, Any, List

from .context import RunnerContext
from .protocol import validate_message
from .transport_ws import WebSocketTransport
from .sink_s3 import S3Sink
from ..adapters.claude.adapter import ClaudeAdapter
from ..adapters.base import RunnerAdapter


class RunnerShell:
    def __init__(self, ctx: RunnerContext) -> None:
        self.ctx = ctx
        self.transport = WebSocketTransport(ctx.ws_url, ctx.auth_token)
        self.sink = S3Sink(ctx.s3_bucket or "", ctx.s3_prefix or "") if ctx.s3_bucket and ctx.s3_prefix else None
        self.buffer: List[str] = []
        self.adapter: RunnerAdapter = self._select_adapter(ctx.runner_adapter)

    def _select_adapter(self, name: str) -> RunnerAdapter:
        # only claude for now
        return ClaudeAdapter()

    async def run(self) -> None:
        ws = await self.transport.connect()
        try:
            # send init
            init_msg = {
                "id": str(uuid.uuid4()),
                "sessionId": self.ctx.session_id,
                "ts": asyncio.get_event_loop().time().__str__(),
                "type": "init",
                "level": "info",
                "seq": 1,
                "payload": {
                    "runnerVersion": "0.1.0",
                    "adapter": self.ctx.runner_adapter,
                    "repo": self.ctx.input_repo,
                    "branch": self.ctx.input_branch,
                },
            }
            await self._send(ws, init_msg)
            self._buffer_line(json.dumps(init_msg))

            await self.adapter.on_init(self.ctx)
            forward_task = asyncio.create_task(self._forward_outbound(ws))

            while True:
                incoming: Dict[str, Any] = await self.transport.recv_json(ws)
                validate_message(incoming)
                self._buffer_line(json.dumps(incoming))
                await self._flush_if_needed()
        finally:
            await ws.close()
            await self.adapter.on_shutdown(self.ctx)
            await self._flush_all()

    async def _forward_outbound(self, ws) -> None:
        async for out in self.adapter.get_outbound_messages(self.ctx):
            validate_message(out)
            await self._send(ws, out)
            self._buffer_line(json.dumps(out))
            await self._flush_if_needed()

    def _buffer_line(self, line: str) -> None:
        self.buffer.append(line)

    async def _flush_if_needed(self) -> None:
        if len(self.buffer) >= 10:
            await self._flush_all()

    async def _flush_all(self) -> None:
        if self.sink and self.buffer:
            self.sink.append_lines(self.ctx.session_id, self.buffer)
        self.buffer.clear()

    async def _send(self, ws, message: Dict[str, Any]) -> None:
        await self.transport.send_json(ws, message)
