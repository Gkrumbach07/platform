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


def _escape_adk_braces(text: str) -> str:
    """Escape curly braces so ADK doesn't interpret them as session state variables.

    Google ADK's ``instructions_utils`` treats ``{variable}`` in the instruction
    string as a session-state template. Our workspace context prompt may contain
    literal braces (e.g. JSON examples, code snippets) that must be escaped.
    """
    # ADK uses single braces {var}. Escaping is done by doubling: {{ and }}.
    return text.replace("{", "{{").replace("}", "}}")


def build_adk_instruction(workspace_path: str, cwd_path: str) -> str:
    """Build the full instruction string for the ADK LlmAgent.

    Combines an ADK preamble with the platform workspace context prompt.
    Escapes curly braces to prevent ADK from interpreting them as
    session state template variables.
    """
    workspace_prompt = resolve_workspace_prompt(workspace_path, cwd_path)
    return _ADK_PREAMBLE + _escape_adk_braces(workspace_prompt)
