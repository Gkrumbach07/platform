from typing import Iterable
import io
import os
import boto3  # type: ignore


class S3Sink:
    def __init__(self, bucket: str, prefix: str) -> None:
        self.bucket = bucket
        self.prefix = prefix.rstrip("/")
        self.client = boto3.client(
            "s3",
            endpoint_url=os.getenv("S3_ENDPOINT"),
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=os.getenv("AWS_REGION"),
        )

    def object_key(self, session_id: str) -> str:
        return f"{self.prefix}/sessions/{session_id}/messages.json"

    def append_lines(self, session_id: str, lines: Iterable[str]) -> None:
        # naive append: GET existing, concatenate, PUT back (can be improved with MPU)
        key = self.object_key(session_id)
        try:
            obj = self.client.get_object(Bucket=self.bucket, Key=key)
            existing = obj["Body"].read()
        except self.client.exceptions.NoSuchKey:  # type: ignore
            existing = b""
        buf = io.BytesIO()
        buf.write(existing)
        for line in lines:
            buf.write(line.encode("utf-8"))
            if not line.endswith("\n"):
                buf.write(b"\n")
        buf.seek(0)
        self.client.put_object(Bucket=self.bucket, Key=key, Body=buf)
