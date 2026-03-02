"""
Utility functions for Codex SDK adapter.

Helper functions for message extraction and prompt building.
"""

import logging

from ag_ui.core import RunAgentInput

logger = logging.getLogger(__name__)


def extract_user_message(input_data: RunAgentInput) -> str:
    """Extract the user message from RunAgentInput.

    Codex SDK manages conversation history natively via threads, so we only
    need the latest user message to forward.

    Args:
        input_data: RunAgentInput with messages array.

    Returns:
        The extracted user message string, or empty string if none found.
    """
    messages = input_data.messages or []
    if not messages:
        logger.warning("No messages in RunAgentInput")
        return ""

    last_msg = messages[-1]

    # Extract content based on message structure
    if hasattr(last_msg, "content"):
        content = last_msg.content
    elif isinstance(last_msg, dict):
        content = last_msg.get("content", "")
    else:
        content = ""

    # Handle different content formats
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if hasattr(block, "text"):
                return block.text
            if isinstance(block, dict) and "text" in block:
                return block["text"]

    logger.warning(f"Could not extract user message from {len(messages)} messages")
    return ""
