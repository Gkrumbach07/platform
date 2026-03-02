"""Smoke tests for the Codex SDK adapter — event parsing and translation."""

import pytest

from ag_ui_codex_sdk.types import (
    AgentMessageItem,
    CommandExecutionItem,
    FileChangeItem,
    ItemCompletedEvent,
    ItemStartedEvent,
    ItemUpdatedEvent,
    McpToolCallItem,
    ReasoningItem,
    ThreadErrorEvent,
    ThreadStartedEvent,
    TurnCompletedEvent,
    TurnFailedEvent,
    parse_event,
    parse_item,
)


class TestParseItem:
    """Verify item dicts are parsed into the correct dataclass."""

    def test_agent_message(self):
        item = parse_item({"id": "1", "type": "agent_message", "text": "Hello"})
        assert isinstance(item, AgentMessageItem)
        assert item.text == "Hello"

    def test_reasoning(self):
        item = parse_item({"id": "2", "type": "reasoning", "text": "thinking..."})
        assert isinstance(item, ReasoningItem)
        assert item.text == "thinking..."

    def test_command_execution(self):
        item = parse_item(
            {
                "id": "3",
                "type": "command_execution",
                "command": "ls -la",
                "aggregated_output": "total 0",
                "exit_code": 0,
                "status": "completed",
            }
        )
        assert isinstance(item, CommandExecutionItem)
        assert item.command == "ls -la"
        assert item.exit_code == 0

    def test_file_change(self):
        item = parse_item(
            {
                "id": "4",
                "type": "file_change",
                "changes": [{"path": "main.py", "kind": "update"}],
                "status": "completed",
            }
        )
        assert isinstance(item, FileChangeItem)
        assert item.changes[0]["path"] == "main.py"

    def test_mcp_tool_call(self):
        item = parse_item(
            {
                "id": "5",
                "type": "mcp_tool_call",
                "server": "my_server",
                "tool": "search",
                "arguments": {"query": "test"},
                "status": "in_progress",
            }
        )
        assert isinstance(item, McpToolCallItem)
        assert item.tool == "search"

    def test_unknown_type_returns_error_item(self):
        from ag_ui_codex_sdk.types import ErrorItem

        item = parse_item({"id": "6", "type": "unknown_thing"})
        assert isinstance(item, ErrorItem)


class TestParseEvent:
    """Verify event dicts are parsed into the correct dataclass."""

    def test_thread_started(self):
        evt = parse_event({"type": "thread.started", "thread_id": "t1"})
        assert isinstance(evt, ThreadStartedEvent)
        assert evt.thread_id == "t1"

    def test_turn_completed(self):
        evt = parse_event(
            {
                "type": "turn.completed",
                "usage": {"input_tokens": 10, "cached_input_tokens": 0, "output_tokens": 20},
            }
        )
        assert isinstance(evt, TurnCompletedEvent)
        assert evt.usage["output_tokens"] == 20

    def test_turn_failed(self):
        evt = parse_event(
            {"type": "turn.failed", "error": {"message": "rate limit"}}
        )
        assert isinstance(evt, TurnFailedEvent)
        assert evt.error["message"] == "rate limit"

    def test_item_started(self):
        evt = parse_event(
            {
                "type": "item.started",
                "item": {"id": "1", "type": "agent_message", "text": "hi"},
            }
        )
        assert isinstance(evt, ItemStartedEvent)
        assert isinstance(evt.item, AgentMessageItem)

    def test_item_updated(self):
        evt = parse_event(
            {
                "type": "item.updated",
                "item": {"id": "1", "type": "agent_message", "text": "hi there"},
            }
        )
        assert isinstance(evt, ItemUpdatedEvent)
        assert evt.item.text == "hi there"

    def test_item_completed(self):
        evt = parse_event(
            {
                "type": "item.completed",
                "item": {
                    "id": "2",
                    "type": "command_execution",
                    "command": "echo test",
                    "aggregated_output": "test",
                    "exit_code": 0,
                    "status": "completed",
                },
            }
        )
        assert isinstance(evt, ItemCompletedEvent)
        assert isinstance(evt.item, CommandExecutionItem)

    def test_unknown_event_returns_error(self):
        evt = parse_event({"type": "something.weird"})
        assert isinstance(evt, ThreadErrorEvent)


class TestCodexAdapter:
    """Verify the adapter translates events to AG-UI correctly."""

    @pytest.mark.asyncio
    async def test_simple_text_response(self):
        """thread.started + agent_message items + turn.completed → AG-UI events."""
        from ag_ui_codex_sdk.adapter import CodexAdapter
        from ag_ui.core import RunAgentInput

        raw_events = [
            {"type": "thread.started", "thread_id": "t1"},
            {
                "type": "item.started",
                "item": {"id": "m1", "type": "agent_message", "text": ""},
            },
            {
                "type": "item.updated",
                "item": {"id": "m1", "type": "agent_message", "text": "Hello!"},
            },
            {
                "type": "item.completed",
                "item": {"id": "m1", "type": "agent_message", "text": "Hello!"},
            },
            {
                "type": "turn.completed",
                "usage": {"input_tokens": 5, "cached_input_tokens": 0, "output_tokens": 5},
            },
        ]

        async def event_stream():
            for raw in raw_events:
                yield parse_event(raw)

        input_data = RunAgentInput(thread_id="t1", run_id="r1", state={}, messages=[], tools=[], context=[], forwardedProps={})
        adapter = CodexAdapter()
        events = []
        async for event in adapter.run(input_data, event_stream=event_stream()):
            events.append(event)

        types = [e.type for e in events]
        assert "RUN_STARTED" in types
        assert "TEXT_MESSAGE_START" in types
        assert "TEXT_MESSAGE_CONTENT" in types
        assert "TEXT_MESSAGE_END" in types
        assert "RUN_FINISHED" in types

    @pytest.mark.asyncio
    async def test_command_execution_flow(self):
        """command_execution items → TOOL_CALL events."""
        from ag_ui_codex_sdk.adapter import CodexAdapter
        from ag_ui.core import RunAgentInput

        raw_events = [
            {"type": "thread.started", "thread_id": "t1"},
            {
                "type": "item.started",
                "item": {
                    "id": "c1",
                    "type": "command_execution",
                    "command": "ls",
                    "aggregated_output": "",
                    "status": "in_progress",
                },
            },
            {
                "type": "item.completed",
                "item": {
                    "id": "c1",
                    "type": "command_execution",
                    "command": "ls",
                    "aggregated_output": "file.txt",
                    "exit_code": 0,
                    "status": "completed",
                },
            },
            {
                "type": "turn.completed",
                "usage": {"input_tokens": 5, "cached_input_tokens": 0, "output_tokens": 5},
            },
        ]

        async def event_stream():
            for raw in raw_events:
                yield parse_event(raw)

        input_data = RunAgentInput(thread_id="t1", run_id="r1", state={}, messages=[], tools=[], context=[], forwardedProps={})
        adapter = CodexAdapter()
        events = []
        async for event in adapter.run(input_data, event_stream=event_stream()):
            events.append(event)

        types = [e.type for e in events]
        assert "TOOL_CALL_START" in types
        assert "TOOL_CALL_END" in types
