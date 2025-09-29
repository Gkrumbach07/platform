# Quickstart

## Prerequisites
- User is logged in via Red Hat SSO and has connected GitHub (per-user App installed).
- User has at least `ambient-project-edit` in the project namespace.
- Upstream umbrella repo exists; user has read access (write optional).
- S3/MinIO configured for the project.

## Create workspace
1. Provide upstream repo and workspace name.
2. System ensures canonical branch `rfe/{workspaceSlug}` exists and bootstrap structure if missing.
3. Persist pointers (upstream URL, canonical, bucket/prefix).

## Run Specify
1. Checkout `rfe/{workspaceSlug}`.
2. `export SPECIFY_FEATURE="{workspaceSlug}-planning"`.
3. `specify --no-git "Initialize/refresh planning spec"`.
4. Commit `specs/{SPECIFY_FEATURE}/*` and:
   - Push directly if user has upstream write, or
   - Push to user fork and open PR to canonical.

## Start a session
1. Select runner type (claude/openai/localexec), fork target, and confirm submodule access.
2. Runner mounts PVC, clones upstream canonical, updates submodules.
3. Create session branches per changed repo (umbrella + submodules).
4. Commit and push to user fork(s).
5. Open PRs: one for umbrella canonical, one per changed submodule.
6. Messages stream via WS and persist to S3; large outputs arrive as partial fragments and are reassembled by the UI.

## Review and merge
- Review PRs in upstream repos.
- Canonical branch merges via merge commits (no squash/rebase).
- UI shows grouped PR status per session.
