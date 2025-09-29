import asyncio
import json
import websockets  # type: ignore
from typing import AsyncIterator, Callable, Dict, Any


class WebSocketTransport:
    def __init__(self, url: str, token: str) -> None:
        self.url = url
        self.token = token

    async def connect(self) -> websockets.WebSocketClientProtocol:  # type: ignore
        return await websockets.connect(self.url, extra_headers={"Authorization": f"Bearer {self.token}"})

    async def send_json(self, ws: websockets.WebSocketClientProtocol, message: Dict[str, Any]) -> None:  # type: ignore
        await ws.send(json.dumps(message))

    async def recv_json(self, ws: websockets.WebSocketClientProtocol) -> Dict[str, Any]:  # type: ignore
        msg = await ws.recv()
        return json.loads(msg)
