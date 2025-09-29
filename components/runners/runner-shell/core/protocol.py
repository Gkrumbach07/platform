from dataclasses import dataclass
from typing import Any, Dict, Optional
from datetime import datetime


@dataclass
class Message:
    id: str
    sessionId: str
    ts: str
    type: str
    level: str
    seq: int
    payload: Dict[str, Any]
    step: Optional[str] = None
    origin: Optional[str] = None
    partial: Optional[Dict[str, Any]] = None


ALLOWED_TYPES = {
    "init",
    "log",
    "status",
    "command_start",
    "command_output",
    "command_end",
    "file_change",
    "git_event",
    "pr_event",
    "tool_event",
    "result",
    "error",
    "heartbeat",
}

ALLOWED_LEVELS = {"info", "warn", "error"}


def validate_message(msg: Dict[str, Any]) -> None:
    required = ["id", "sessionId", "ts", "type", "level", "seq", "payload"]
    for k in required:
        if k not in msg:
            raise ValueError(f"missing field: {k}")
    if msg["type"] not in ALLOWED_TYPES:
        raise ValueError("invalid type")
    if msg["level"] not in ALLOWED_LEVELS:
        raise ValueError("invalid level")
    # basic ts check
    try:
        datetime.fromisoformat(msg["ts"].replace("Z", "+00:00"))
    except Exception as e:
        raise ValueError("invalid ts") from e
    # partial fragment shape if present
    if "partial" in msg and msg["partial"] is not None:
        p = msg["partial"]
        for k in ("id", "index", "total"):
            if k not in p:
                raise ValueError("invalid partial")
