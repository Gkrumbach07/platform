# Runner Shell + Adapter Design

## Goal
Standardize messaging, persistence, and lifecycle so multiple runner types (e.g., claude, openai, localexec) can plug in behind a common shell.

## Components
- Shell (core): networking, reliability, persistence
- Adapter (per runner): implements hooks
- Protocol: JSON schema for input/output messages
- Transports: WebSocket (primary), HTTP fallback
- Sink: S3/MinIO message log appender (+ artifacts upload)

## Message Protocol (outline)
- Common fields: sessionId, workspaceId, repo, branch, step, level, ts, type, payload, artifacts[]
- Types: init, status, log, event, prompt, result, error, heartbeat

## Protocol schema (Claude baseline)

### Envelope (all messages)
- id (string, UUID)
- sessionId (string)
- ts (RFC3339)
- type (enum)
- level (info|warn|error)
- step (string?)
- origin (runner|backend|ui)
- seq (int, monotonic per session)

### Common payload fields
- text (string?)
- markdown (string?)
- json (object?)
- meta (object)
- partial (object?): { id: string, index: int, total: int }

### Core types and payloads
- init: { runnerVersion, adapter, repo, branch }
- log: { text }
- status: { phase (starting|running|finalizing|done), progress (0–100) }
- command_start: { cmd, cwd }
- command_output: { stream (stdout|stderr), chunk }
- command_end: { cmd, exitCode, durationMs }
- file_change: { path, change (create|update|delete|rename), diff? }
- git_event: { action (clone|checkout|pull|commit|push), repo, branch, details }
- pr_event: { action (open|update|merge|close), repo, number, url, base, head }
- tool_event: { name, action (start|end), args?, result? }
- result: { summary, artifacts[] }
- error: { code, message, stack? }
- heartbeat: {}

### JSON examples
```json
{"id":"e7f...","sessionId":"s-123","ts":"2025-09-26T19:54:01Z","type":"init","level":"info","seq":1,"payload":{"runnerVersion":"1.2.3","adapter":"claude","repo":"org/umbrella","branch":"rfe/foo"}}
{"id":"a1b...","sessionId":"s-123","ts":"2025-09-26T19:54:03Z","type":"command_start","level":"info","seq":2,"payload":{"cmd":"git clone https://...","cwd":"/workspace"}}
{"id":"c9d...","sessionId":"s-123","ts":"2025-09-26T19:54:04Z","type":"command_output","level":"info","seq":3,"payload":{"stream":"stdout","chunk":"Cloning into 'work'..."}}
{"id":"f0e...","sessionId":"s-123","ts":"2025-09-26T19:54:06Z","type":"file_change","level":"info","seq":10,"payload":{"path":"specs/foo/spec.md","change":"update","diff":"---\n+++ ..."}}
{"id":"9aa...","sessionId":"s-123","ts":"2025-09-26T19:54:20Z","type":"pr_event","level":"info","seq":25,"payload":{"action":"open","repo":"org/umbrella","number":42,"url":"https://github.com/.../pull/42","base":"rfe/foo","head":"user:branch"}}
{"id":"dea...","sessionId":"s-123","ts":"2025-09-26T19:54:30Z","type":"result","level":"info","seq":30,"payload":{"summary":"Updated spec, opened PR #42","artifacts":[]}}
```

### Persistence and rollover
- Append as JSONL to `sessions/{sessionId}/messages.json` in order of `seq`.
- Roll over at size (e.g., 50MB): `messages-0001.json`, `messages-0002.json`, ...
- Batch appends (N messages or seconds) for efficiency; flush on shutdown.
 - Partial fragments are stored as individual records; UI reassembles by `partial.id` and order (`partial.index`).

## Adapter Contract
```python
class RunnerAdapter:
    def on_init(self, ctx): ...
    def on_input(self, ctx, message): ...
    def on_tick(self, ctx): ...
    def on_cancel(self, ctx, reason): ...
    def on_shutdown(self, ctx): ...
```

## Shell Responsibilities
- Validate/normalize messages to protocol
- Maintain WS connection (auth, heartbeats, reconnect)
- Append durable logs to `sessions/{sessionId}/messages.json`
- Handle cancel/timeouts and graceful shutdown
- Emit artifact metadata and upload lazily

## Env/Config passed by backend
- RUNNER_ADAPTER=claude|openai|localexec
- WS_URL, AUTH_TOKEN
- S3_BUCKET, S3_PREFIX
- SESSION_ID, WORKFLOW_ID, WORKSPACE_SLUG
- INPUT/OUTPUT repo/branch (optional for non‑RFE)

## Directory Layout (proposed)
```
components/runners/
  runner-shell/
    core/
      shell.py
      protocol.py
      transport_ws.py
      sink_s3.py
      context.py
    adapters/
      claude/adapter.py
      openai/adapter.py (future)
      localexec/adapter.py (future)
    cli/__main__.py
    tests/
  claude-code-runner/ (migrate to use adapters/claude)
```

## Backend integration
- Session spec adds runnerType and optional capabilities
- Launcher sets env and mounts per-session Secret with HTTPS creds

## Benefits
- Swap adapters without changing messaging or persistence
- Consistent UI/Backend semantics
- Clear separation: shell = plumbing, adapter = logic
