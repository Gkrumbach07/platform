import asyncio
from ..core.context import RunnerContext
from ..core.shell import RunnerShell
from ..adapters.claude.adapter import ClaudeAdapter


async def main() -> None:
    ctx = RunnerContext.from_env()
    # wire adapter (single for now)
    _ = ClaudeAdapter()
    shell = RunnerShell(ctx)
    await shell.run()


if __name__ == "__main__":
    asyncio.run(main())
