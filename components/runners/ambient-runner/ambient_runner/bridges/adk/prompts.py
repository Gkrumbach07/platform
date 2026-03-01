"""
ADK-specific instruction construction.

Builds the agent instruction by reusing the shared platform workspace
context prompt and prepending an ADK-specific preamble.
"""

from ambient_runner.platform.prompts import resolve_workspace_prompt

_ADK_PREAMBLE = (
    "You are a helpful coding assistant running inside the Ambient Code "
    "Platform. You have full filesystem access to the workspace and can "
    "use tools to read, write, and execute commands.\n\n"
)


def build_adk_instruction(workspace_path: str, cwd_path: str) -> str:
    """Build the full instruction string for the ADK LlmAgent.

    Combines an ADK preamble with the platform workspace context prompt.
    """
    return _ADK_PREAMBLE + resolve_workspace_prompt(workspace_path, cwd_path)
