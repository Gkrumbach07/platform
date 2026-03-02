"""
Codex SDK adapter for AG-UI protocol.

This adapter translates Codex SDK streaming events into AG-UI protocol events,
enabling Codex-powered agents to work with any AG-UI compatible frontend.

Codex text does NOT stream character-by-character in exec --json mode.
Messages arrive as complete chunks, so each TEXT_MESSAGE_CONTENT event
contains the full text rather than individual deltas.
"""

import json
import logging
import uuid
from typing import Any, AsyncIterator, Optional

from ag_ui.core import (
    BaseEvent,
    CustomEvent,
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)

from .types import (
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
    WebSearchItem,
    parse_event,
)

logger = logging.getLogger(__name__)


class CodexAdapter:
    """Adapter that wraps the Codex SDK for AG-UI servers.

    Translates Codex streaming events (from ``thread.run_streamed()``) into
    AG-UI protocol events via an async generator.

    The adapter is a pure protocol translator — the caller owns the Codex
    client lifecycle and provides the event stream.
    """

    def __init__(self) -> None:
        self._thread_id: Optional[str] = None
        self._tool_call_counter: int = 0

    async def run(
        self,
        input_data: RunAgentInput,
        *,
        event_stream: AsyncIterator[Any],
    ) -> AsyncIterator[BaseEvent]:
        """Process a Codex event stream and yield AG-UI events.

        Args:
            input_data: RunAgentInput with thread_id, run_id, messages, etc.
            event_stream: Async iterator of Codex SDK events from
                ``thread.run_streamed().events``.

        Yields:
            AG-UI BaseEvent instances.
        """
        thread_id = input_data.thread_id or str(uuid.uuid4())
        run_id = input_data.run_id or str(uuid.uuid4())
        self._tool_call_counter = 0

        try:
            # 1. Emit RUN_STARTED
            yield RunStartedEvent(
                type=EventType.RUN_STARTED,
                thread_id=thread_id,
                run_id=run_id,
            )

            # 2. Process events from the Codex stream
            async for raw_event in event_stream:
                # Parse raw event if it's a dict; otherwise use as-is
                if isinstance(raw_event, dict):
                    event = parse_event(raw_event)
                else:
                    event = raw_event

                async for ag_ui_event in self._translate_event(
                    event, thread_id, run_id
                ):
                    yield ag_ui_event

            # 3. Emit RUN_FINISHED at end (if not already emitted by turn.completed)
            yield RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
            )

        except Exception as e:
            logger.error("Error in Codex adapter run: %s", e)
            yield RunErrorEvent(
                type=EventType.RUN_ERROR,
                thread_id=thread_id,
                run_id=run_id,
                message=str(e),
            )
        finally:
            # Emit RUN_FINISHED if not already emitted (e.g. on error)
            pass

    async def _translate_event(
        self,
        event: Any,
        thread_id: str,
        run_id: str,
    ) -> AsyncIterator[BaseEvent]:
        """Translate a single Codex event into AG-UI events."""

        # --- Thread lifecycle ---
        if isinstance(event, ThreadStartedEvent):
            self._thread_id = event.thread_id
            logger.debug("Codex thread started: %s", event.thread_id)
            return

        # --- Turn lifecycle ---
        if isinstance(event, TurnCompletedEvent):
            usage = event.usage or {}
            logger.debug("Turn completed, usage: %s", usage)
            # RUN_FINISHED is emitted by the outer run() loop
            return

        if isinstance(event, TurnFailedEvent):
            error_msg = (event.error or {}).get("message", "Turn failed")
            logger.error("Codex turn failed: %s", error_msg)
            yield RunErrorEvent(
                type=EventType.RUN_ERROR,
                thread_id=thread_id,
                run_id=run_id,
                message=error_msg,
            )
            return

        if isinstance(event, ThreadErrorEvent):
            logger.error("Codex thread error: %s", event.message)
            yield RunErrorEvent(
                type=EventType.RUN_ERROR,
                thread_id=thread_id,
                run_id=run_id,
                message=event.message or "Thread error",
            )
            return

        # --- Item lifecycle ---
        if isinstance(event, (ItemStartedEvent, ItemUpdatedEvent, ItemCompletedEvent)):
            item = event.item
            if item is None:
                return

            event_phase = event.type.split(".")[-1]  # started | updated | completed

            # Agent message
            if isinstance(item, AgentMessageItem):
                async for ev in self._handle_agent_message(
                    item, event_phase, thread_id, run_id
                ):
                    yield ev

            # Reasoning / thinking
            elif isinstance(item, ReasoningItem):
                async for ev in self._handle_reasoning(
                    item, event_phase, thread_id, run_id
                ):
                    yield ev

            # Command execution (bash)
            elif isinstance(item, CommandExecutionItem):
                async for ev in self._handle_command_execution(
                    item, event_phase, thread_id, run_id
                ):
                    yield ev

            # File changes
            elif isinstance(item, FileChangeItem):
                async for ev in self._handle_file_change(
                    item, event_phase, thread_id, run_id
                ):
                    yield ev

            # MCP tool call
            elif isinstance(item, McpToolCallItem):
                async for ev in self._handle_mcp_tool_call(
                    item, event_phase, thread_id, run_id
                ):
                    yield ev

            # Web search
            elif isinstance(item, WebSearchItem):
                if event_phase == "started":
                    async for ev in self._handle_web_search(item, thread_id, run_id):
                        yield ev

    # ------------------------------------------------------------------
    # Item handlers
    # ------------------------------------------------------------------

    async def _handle_agent_message(
        self,
        item: AgentMessageItem,
        phase: str,
        thread_id: str,
        run_id: str,
    ) -> AsyncIterator[BaseEvent]:
        """Translate agent_message item events to TEXT_MESSAGE events."""
        message_id = str(uuid.uuid4())

        if phase == "started":
            yield TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=message_id,
                role="assistant",
            )
        elif phase == "updated":
            # Codex sends full text (not deltas) — emit as one chunk
            yield TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=message_id,
                delta=item.text or "",
            )
        elif phase == "completed":
            # Emit final text if present (may not have had an update event)
            if item.text:
                yield TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=message_id,
                    delta=item.text,
                )
            yield TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=message_id,
            )

    async def _handle_reasoning(
        self,
        item: ReasoningItem,
        phase: str,
        thread_id: str,
        run_id: str,
    ) -> AsyncIterator[BaseEvent]:
        """Translate reasoning item events to thinking custom events."""
        if phase == "started":
            yield CustomEvent(
                type=EventType.CUSTOM,
                thread_id=thread_id,
                run_id=run_id,
                name="thinking_start",
                value={},
            )
        elif phase == "completed":
            yield CustomEvent(
                type=EventType.CUSTOM,
                thread_id=thread_id,
                run_id=run_id,
                name="thinking_end",
                value={"text": item.text or ""},
            )

    async def _handle_command_execution(
        self,
        item: CommandExecutionItem,
        phase: str,
        thread_id: str,
        run_id: str,
    ) -> AsyncIterator[BaseEvent]:
        """Translate command_execution item events to TOOL_CALL events."""
        tool_call_id = self._next_tool_call_id()

        if phase == "started":
            yield ToolCallStartEvent(
                type=EventType.TOOL_CALL_START,
                tool_call_id=tool_call_id,
                tool_call_name="bash",
            )
            yield ToolCallArgsEvent(
                type=EventType.TOOL_CALL_ARGS,
                tool_call_id=tool_call_id,
                delta=json.dumps({"command": item.command}),
            )
        elif phase == "completed":
            yield ToolCallEndEvent(
                type=EventType.TOOL_CALL_END,
                tool_call_id=tool_call_id,
            )
            result = item.aggregated_output or ""
            if item.exit_code is not None and item.exit_code != 0:
                result += f"\n[exit code: {item.exit_code}]"
            yield ToolCallResultEvent(
                type=EventType.TOOL_CALL_RESULT,
                tool_call_id=tool_call_id,
                message_id=f"{tool_call_id}-result",
                role="tool",
                content=result,
            )

    async def _handle_file_change(
        self,
        item: FileChangeItem,
        phase: str,
        thread_id: str,
        run_id: str,
    ) -> AsyncIterator[BaseEvent]:
        """Translate file_change item events to TOOL_CALL events."""
        tool_call_id = self._next_tool_call_id()

        if phase == "started":
            yield ToolCallStartEvent(
                type=EventType.TOOL_CALL_START,
                tool_call_id=tool_call_id,
                tool_call_name="file_edit",
            )
            yield ToolCallArgsEvent(
                type=EventType.TOOL_CALL_ARGS,
                tool_call_id=tool_call_id,
                delta=json.dumps({"changes": item.changes}),
            )
        elif phase == "completed":
            yield ToolCallEndEvent(
                type=EventType.TOOL_CALL_END,
                tool_call_id=tool_call_id,
            )
            summary = ", ".join(f"{c.get('kind', '?')} {c.get('path', '?')}" for c in (item.changes or []))
            yield ToolCallResultEvent(
                type=EventType.TOOL_CALL_RESULT,
                tool_call_id=tool_call_id,
                message_id=f"{tool_call_id}-result",
                role="tool",
                content=summary or "file changes applied",
            )

    async def _handle_mcp_tool_call(
        self,
        item: McpToolCallItem,
        phase: str,
        thread_id: str,
        run_id: str,
    ) -> AsyncIterator[BaseEvent]:
        """Translate mcp_tool_call item events to TOOL_CALL events."""
        tool_call_id = self._next_tool_call_id()

        if phase == "started":
            yield ToolCallStartEvent(
                type=EventType.TOOL_CALL_START,
                tool_call_id=tool_call_id,
                tool_call_name=item.tool,
            )
            yield ToolCallArgsEvent(
                type=EventType.TOOL_CALL_ARGS,
                tool_call_id=tool_call_id,
                delta=json.dumps(item.arguments),
            )
        elif phase == "completed":
            yield ToolCallEndEvent(
                type=EventType.TOOL_CALL_END,
                tool_call_id=tool_call_id,
            )
            result = ""
            if item.result:
                result = json.dumps(item.result)
            elif item.error:
                result = json.dumps(item.error)
            yield ToolCallResultEvent(
                type=EventType.TOOL_CALL_RESULT,
                tool_call_id=tool_call_id,
                message_id=f"{tool_call_id}-result",
                role="tool",
                content=result or "tool call completed",
            )

    async def _handle_web_search(
        self,
        item: WebSearchItem,
        thread_id: str,
        run_id: str,
    ) -> AsyncIterator[BaseEvent]:
        """Translate web_search item start to TOOL_CALL events."""
        tool_call_id = self._next_tool_call_id()

        yield ToolCallStartEvent(
            type=EventType.TOOL_CALL_START,
            tool_call_id=tool_call_id,
            tool_call_name="web_search",
        )
        yield ToolCallArgsEvent(
            type=EventType.TOOL_CALL_ARGS,
            tool_call_id=tool_call_id,
            delta=json.dumps({"query": item.query}),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _next_tool_call_id(self) -> str:
        """Generate a unique tool call ID."""
        self._tool_call_counter += 1
        return f"codex_tc_{self._tool_call_counter}_{uuid.uuid4().hex[:8]}"
