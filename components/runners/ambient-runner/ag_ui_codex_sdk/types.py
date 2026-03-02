"""
Codex SDK event type definitions.

Python dataclasses representing Codex streaming events (from ``exec --json``).
These are the raw event shapes emitted by the Codex SDK's ``thread.run_streamed()``
method, before translation to AG-UI protocol events.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


# ---------------------------------------------------------------------------
# Item types (ThreadItem union)
# ---------------------------------------------------------------------------


@dataclass
class AgentMessageItem:
    id: str
    type: str = "agent_message"
    text: str = ""


@dataclass
class ReasoningItem:
    id: str
    type: str = "reasoning"
    text: str = ""


@dataclass
class CommandExecutionItem:
    id: str
    type: str = "command_execution"
    command: str = ""
    aggregated_output: str = ""
    exit_code: Optional[int] = None
    status: str = "in_progress"


@dataclass
class FileChangeItem:
    id: str
    type: str = "file_change"
    changes: List[Dict[str, str]] = field(default_factory=list)
    status: str = "in_progress"


@dataclass
class McpToolCallItem:
    id: str
    type: str = "mcp_tool_call"
    server: str = ""
    tool: str = ""
    arguments: Dict[str, Any] = field(default_factory=dict)
    result: Optional[str] = None
    error: Optional[str] = None
    status: str = "in_progress"


@dataclass
class WebSearchItem:
    id: str
    type: str = "web_search"
    query: str = ""


@dataclass
class TodoListItem:
    id: str
    type: str = "todo_list"
    items: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ErrorItem:
    id: str
    type: str = "error"
    message: str = ""


ThreadItem = Union[
    AgentMessageItem,
    ReasoningItem,
    CommandExecutionItem,
    FileChangeItem,
    McpToolCallItem,
    WebSearchItem,
    TodoListItem,
    ErrorItem,
]

_ITEM_TYPE_MAP: Dict[str, type] = {
    "agent_message": AgentMessageItem,
    "reasoning": ReasoningItem,
    "command_execution": CommandExecutionItem,
    "file_change": FileChangeItem,
    "mcp_tool_call": McpToolCallItem,
    "web_search": WebSearchItem,
    "todo_list": TodoListItem,
    "error": ErrorItem,
}


# ---------------------------------------------------------------------------
# Thread lifecycle events
# ---------------------------------------------------------------------------


@dataclass
class ThreadStartedEvent:
    type: str = "thread.started"
    thread_id: str = ""


@dataclass
class TurnStartedEvent:
    type: str = "turn.started"


@dataclass
class TurnCompletedEvent:
    type: str = "turn.completed"
    usage: Dict[str, int] = field(default_factory=dict)


@dataclass
class TurnFailedEvent:
    type: str = "turn.failed"
    error: Dict[str, str] = field(default_factory=dict)


@dataclass
class ThreadErrorEvent:
    type: str = "error"
    message: str = ""


# ---------------------------------------------------------------------------
# Item lifecycle events
# ---------------------------------------------------------------------------


@dataclass
class ItemStartedEvent:
    type: str = "item.started"
    item: Optional[ThreadItem] = None


@dataclass
class ItemUpdatedEvent:
    type: str = "item.updated"
    item: Optional[ThreadItem] = None


@dataclass
class ItemCompletedEvent:
    type: str = "item.completed"
    item: Optional[ThreadItem] = None


CodexEvent = Union[
    ThreadStartedEvent,
    TurnStartedEvent,
    TurnCompletedEvent,
    TurnFailedEvent,
    ThreadErrorEvent,
    ItemStartedEvent,
    ItemUpdatedEvent,
    ItemCompletedEvent,
]


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def parse_item(raw: Dict[str, Any]) -> ThreadItem:
    """Parse a raw dict into the appropriate ThreadItem dataclass."""
    item_type = raw.get("type", "")
    cls = _ITEM_TYPE_MAP.get(item_type)
    if cls is None:
        return ErrorItem(
            id=raw.get("id", "unknown"), message=f"Unknown item type: {item_type}"
        )

    # Build kwargs from the dataclass fields, picking only known keys
    import dataclasses

    field_names = {f.name for f in dataclasses.fields(cls)}
    kwargs = {k: v for k, v in raw.items() if k in field_names}
    return cls(**kwargs)


_EVENT_TYPE_MAP: Dict[str, type] = {
    "thread.started": ThreadStartedEvent,
    "turn.started": TurnStartedEvent,
    "turn.completed": TurnCompletedEvent,
    "turn.failed": TurnFailedEvent,
    "error": ThreadErrorEvent,
    "item.started": ItemStartedEvent,
    "item.updated": ItemUpdatedEvent,
    "item.completed": ItemCompletedEvent,
}


def parse_event(raw: Dict[str, Any]) -> CodexEvent:
    """Parse a raw dict into the appropriate Codex event dataclass."""
    event_type = raw.get("type", "")
    cls = _EVENT_TYPE_MAP.get(event_type)
    if cls is None:
        return ThreadErrorEvent(message=f"Unknown event type: {event_type}")

    # For item events, parse the nested item first
    if event_type.startswith("item."):
        raw_item = raw.get("item")
        item = parse_item(raw_item) if isinstance(raw_item, dict) else None
        return cls(item=item)

    # For thread/turn events, extract known fields
    import dataclasses

    field_names = {f.name for f in dataclasses.fields(cls)}
    kwargs = {k: v for k, v in raw.items() if k in field_names}
    return cls(**kwargs)
