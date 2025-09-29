# Research

## Decisions
- Auth to Git: per-user GitHub App installation tokens; no org app.
- SSO mapping: maintain SSO → {githubUserId, installationId(s)} in backend.
- Canonical branch: `rfe/{workspaceSlug}` on umbrella upstream repo.
- Specify writes: to `specs/{SPECIFY_FEATURE}` on canonical; if no upstream write, push to user fork and open PR.
- Sessions: clone upstream canonical; push to user fork session branch; PR back to canonical. For submodules, separate PRs per repo.
- Messaging: WebSocket backend↔runner; persist messages to S3 `sessions/{id}/messages.json`; support streamed partial messages with client-side reassembly.
- Runner Shell: abstract messaging/persistence; adapters implement hooks (claude, openai, localexec).
- Storage: S3/MinIO only for messages/artifacts (no repo mirror).
- Merge policy: merge commits into canonical (no squash/rebase).

## Rationale
- Per-user install tokens match “users only” access, avoid org-wide app and PAT management.
- Single canonical branch per workspace simplifies defaults and UI.
- Fork-based PRs align with least privilege and enable contributors without upstream write.
- Separate PRs per submodule keep ownership and review boundaries clear.

## Alternatives considered
- Org app for upstream: simpler rate limits, but not required and increases admin coupling.
- S3 bare mirror: reduces upstream egress, but adds complexity and locking; unnecessary initially.
- Squash commits: cleaner history, but loses session branch context.

## Open items to watch
- Provider rate limits: use ETag caching on backend for tree/blob.
- Private submodule access: validate at session start; partial checkout policy defined.
