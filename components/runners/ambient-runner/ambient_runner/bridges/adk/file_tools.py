"""
ADK file system tools — read, write, edit, list, and bash execution.

Gives the ADK agent the same filesystem capabilities that Claude gets
from its built-in CLI tools. All paths are validated to stay within
WORKSPACE_PATH using the same safety logic as the content endpoints.
"""

import glob as _glob
import logging
import os
import re
import subprocess
from pathlib import Path

from google.adk.tools import FunctionTool

logger = logging.getLogger(__name__)


def _workspace() -> Path:
    return Path(os.getenv("WORKSPACE_PATH", "/workspace")).resolve()


def _safe_resolve(relative: str) -> Path:
    """Resolve a path under WORKSPACE_PATH; raise ValueError on traversal."""
    workspace = _workspace()
    cleaned = relative.lstrip("/")
    target = (workspace / cleaned).resolve()
    if not (target == workspace or str(target).startswith(str(workspace) + os.sep)):
        raise ValueError(f"Path traversal blocked: {relative}")
    return target


# ------------------------------------------------------------------
# File read
# ------------------------------------------------------------------


def create_read_file_tool() -> FunctionTool:
    """Read file contents."""

    def read_file(path: str) -> dict:
        """Read the contents of a file at the given path.

        Args:
            path: Relative path from workspace root (e.g. "src/main.py").

        Returns:
            File contents or error message.
        """
        try:
            abs_path = _safe_resolve(path)
            if not abs_path.exists():
                return {"status": "error", "message": f"File not found: {path}"}
            if abs_path.is_dir():
                return {"status": "error", "message": f"Path is a directory: {path}"}
            content = abs_path.read_text(errors="replace")
            return {"status": "ok", "content": content}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return FunctionTool(func=read_file)


# ------------------------------------------------------------------
# File write
# ------------------------------------------------------------------


def create_write_file_tool() -> FunctionTool:
    """Write/create a file."""

    def write_file(path: str, content: str) -> dict:
        """Write content to a file, creating parent directories as needed.

        Args:
            path: Relative path from workspace root (e.g. "artifacts/output.txt").
            content: The full file content to write.

        Returns:
            Status message.
        """
        try:
            abs_path = _safe_resolve(path)
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_text(content)
            return {"status": "ok", "message": f"Wrote {len(content)} chars to {path}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return FunctionTool(func=write_file)


# ------------------------------------------------------------------
# File edit (string replacement)
# ------------------------------------------------------------------


def create_edit_file_tool() -> FunctionTool:
    """Edit a file by replacing a string."""

    def edit_file(path: str, old_string: str, new_string: str) -> dict:
        """Replace a specific string in a file. The old_string must appear
        exactly once in the file.

        Args:
            path: Relative path from workspace root.
            old_string: The exact text to find and replace.
            new_string: The replacement text.

        Returns:
            Status message.
        """
        try:
            abs_path = _safe_resolve(path)
            if not abs_path.exists():
                return {"status": "error", "message": f"File not found: {path}"}
            content = abs_path.read_text()
            count = content.count(old_string)
            if count == 0:
                return {"status": "error", "message": "old_string not found in file"}
            if count > 1:
                return {
                    "status": "error",
                    "message": f"old_string found {count} times — must be unique",
                }
            new_content = content.replace(old_string, new_string, 1)
            abs_path.write_text(new_content)
            return {"status": "ok", "message": f"Edited {path}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return FunctionTool(func=edit_file)


# ------------------------------------------------------------------
# List / glob
# ------------------------------------------------------------------


def create_list_directory_tool() -> FunctionTool:
    """List directory contents."""

    def list_directory(path: str = "") -> dict:
        """List files and subdirectories at the given path.

        Args:
            path: Relative path from workspace root. Empty string for root.

        Returns:
            List of entries with name and type.
        """
        try:
            abs_path = _safe_resolve(path)
            if not abs_path.exists():
                return {"status": "error", "message": f"Path not found: {path}"}
            if not abs_path.is_dir():
                return {"status": "error", "message": f"Not a directory: {path}"}
            entries = []
            for entry in sorted(abs_path.iterdir(), key=lambda e: e.name):
                entries.append({
                    "name": entry.name,
                    "is_dir": entry.is_dir(),
                })
            return {"status": "ok", "entries": entries}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return FunctionTool(func=list_directory)


def create_glob_tool() -> FunctionTool:
    """Search for files by pattern."""

    def glob_search(pattern: str) -> dict:
        """Find files matching a glob pattern relative to the workspace.

        Args:
            pattern: Glob pattern (e.g. "**/*.py", "src/**/*.ts").

        Returns:
            List of matching file paths.
        """
        try:
            workspace = _workspace()
            matches = sorted(
                str(Path(m).relative_to(workspace))
                for m in _glob.glob(str(workspace / pattern), recursive=True)
            )
            return {"status": "ok", "matches": matches[:200]}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return FunctionTool(func=glob_search)


def create_grep_tool() -> FunctionTool:
    """Search file contents by regex."""

    def grep_search(pattern: str, path: str = "", glob_filter: str = "") -> dict:
        """Search for a regex pattern in files under the given path.

        Args:
            pattern: Regular expression to search for.
            path: Directory to search in (relative to workspace). Default: root.
            glob_filter: Optional glob to filter files (e.g. "*.py").

        Returns:
            List of matches with file, line number, and content.
        """
        try:
            abs_path = _safe_resolve(path) if path else _workspace()
            if not abs_path.is_dir():
                return {"status": "error", "message": f"Not a directory: {path}"}
            regex = re.compile(pattern)
            results = []
            search_glob = glob_filter or "**/*"
            for fpath in abs_path.glob(search_glob):
                if not fpath.is_file():
                    continue
                try:
                    for i, line in enumerate(fpath.open(errors="replace"), 1):
                        if regex.search(line):
                            results.append({
                                "file": str(fpath.relative_to(_workspace())),
                                "line": i,
                                "content": line.rstrip()[:200],
                            })
                            if len(results) >= 100:
                                return {"status": "ok", "matches": results, "truncated": True}
                except (OSError, UnicodeDecodeError):
                    continue
            return {"status": "ok", "matches": results}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return FunctionTool(func=grep_search)


# ------------------------------------------------------------------
# Bash execution
# ------------------------------------------------------------------


def create_bash_tool() -> FunctionTool:
    """Run a shell command."""

    def bash(command: str, timeout: int = 120) -> dict:
        """Execute a bash command in the workspace directory.

        Args:
            command: The shell command to run.
            timeout: Maximum seconds to wait (default 120).

        Returns:
            stdout, stderr, and exit code.
        """
        try:
            result = subprocess.run(
                ["bash", "-c", command],
                capture_output=True,
                text=True,
                timeout=min(timeout, 300),
                cwd=str(_workspace()),
            )
            return {
                "status": "ok",
                "stdout": result.stdout[-10000:] if len(result.stdout) > 10000 else result.stdout,
                "stderr": result.stderr[-5000:] if len(result.stderr) > 5000 else result.stderr,
                "exit_code": result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {"status": "error", "message": f"Command timed out after {timeout}s"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return FunctionTool(func=bash)


def get_all_file_tools() -> list[FunctionTool]:
    """Return all filesystem + bash tools for the ADK agent."""
    return [
        create_read_file_tool(),
        create_write_file_tool(),
        create_edit_file_tool(),
        create_list_directory_tool(),
        create_glob_tool(),
        create_grep_tool(),
        create_bash_tool(),
    ]
