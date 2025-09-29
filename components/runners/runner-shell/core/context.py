from dataclasses import dataclass
from typing import Optional
import os


@dataclass
class RunnerContext:
    """Runtime context provided to the shell and adapters via environment variables."""

    session_id: str
    workflow_id: Optional[str]
    workspace_slug: Optional[str]
    runner_adapter: str

    ws_url: str
    auth_token: str

    s3_bucket: Optional[str]
    s3_prefix: Optional[str]

    input_repo: Optional[str]
    input_branch: Optional[str]
    output_repo: Optional[str]
    output_branch: Optional[str]

    @staticmethod
    def from_env() -> "RunnerContext":
        return RunnerContext(
            session_id=os.getenv("SESSION_ID", ""),
            workflow_id=os.getenv("WORKFLOW_ID"),
            workspace_slug=os.getenv("WORKSPACE_SLUG"),
            runner_adapter=os.getenv("RUNNER_ADAPTER", "claude"),
            ws_url=os.getenv("WS_URL", ""),
            auth_token=os.getenv("AUTH_TOKEN", ""),
            s3_bucket=os.getenv("S3_BUCKET"),
            s3_prefix=os.getenv("S3_PREFIX"),
            input_repo=os.getenv("INPUT_REPO"),
            input_branch=os.getenv("INPUT_BRANCH"),
            output_repo=os.getenv("OUTPUT_REPO"),
            output_branch=os.getenv("OUTPUT_BRANCH"),
        )
