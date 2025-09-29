# Feature Specification: Runner–Backend Messaging and Storage Overhaul for RFE Workflows

**Feature Branch**: `001-specify-i-want`  
**Created**: 2025-09-26  
**Status**: Draft  
**Input**: Improve runner↔backend messaging and replace per-project PVCs with project-scoped object storage; runner pods use their own PVC for ephemeral work, sync with upstream Git repos, and persist session messages/state to object storage.

---

## Clarifications

### Session 2025-09-26
- Q: For each RFE workspace, what is the upstream binding and canonical branch naming?
  → A: Specific org/repo; canonical branch `rfe/{workspaceSlug}`.
- Q: Which repos do `repos/*` submodules point to, and what access is guaranteed for the logged-in user token?
  → A: External third-party repos allowed; users must already have access.
- Q: How should we handle missing access to any required submodule during a session?
  → A: Skip submodule and continue; mark outputs incomplete.
- Q: Who is allowed to push directly to the upstream canonical branch `rfe/{workspaceSlug}`?
  → A: Anyone with upstream write on the repo.
- Q: Which auth flow should we use to obtain user GitHub tokens?
  → A: GitHub App installed by the user; mint installation tokens; no org app.
 - Q: How do we associate SSO users to GitHub access?
  → A: Maintain SSO↔GitHub user mapping with per-user installation id(s).
- Q: If a session edits both the umbrella repo and a submodule, how many PRs are created?
  → A: Separate PRs per repo (umbrella + each changed submodule).
 - Q: What happens if a user lacks access to umbrella or submodule repos, and how are forks handled?
  → A: UI shows access error on browse; offer fork creation if none; sessions allow optional input/output for non‑RFE runs.
 - Q: Are secrets stored, or do we rely on GitHub App tokens only?
  → A: Do not store user secrets; use short‑lived GitHub App installation tokens only.

## User Scenarios & Testing (mandatory)

### Primary User Story
As a product engineering team member, I want RFE workflows to use reliable two-way messaging between the backend/UI and runner pods, and to persist workflow/session state in project-scoped object storage, so that sessions run independently, scale safely, and changes are synchronized with upstream repositories without PVC sharing constraints.

### Acceptance Scenarios
1. Project setup with internal object storage
   - Given a user creates a new project and selects “Managed Object Storage,”
   - When the project is created,
   - Then the system provisions project-scoped object storage and registers it with the backend for that project.

2. Project setup with external S3-compatible storage
   - Given a user creates a new project and provides S3 bucket configuration and credentials,
   - When the project is created,
   - Then the system validates access and registers the bucket as the project’s storage backend.

3. Workspace created with umbrella upstream repo
   - Given a user creates a workspace and provides the umbrella upstream repository URL,
   - When the workspace is created,
   - Then the system ensures the canonical branch `rfe/{workspaceSlug}` exists, initializes required structure (`.claude/`, `.specify/`, `specs/`, `repos/` as submodules) if missing, and pushes to upstream.

4. Specify populates planning artifacts on canonical branch
   - Given Specify is run for the workspace,
   - When it executes,
   - Then it writes under `specs/{SPECIFY_FEATURE}/` on the canonical branch using the invoking user's GitHub token; if the user has upstream write, it pushes directly, otherwise it pushes to the user's fork and opens a PR to the canonical branch.

5. Session runs with upstream canonical and fork output
   - Given a user starts a session with an input repo/branch and an output repo/branch,
   - When the runner pod starts,
   - Then it mounts its own PVC, clones the umbrella upstream repo at the canonical branch into the working directory, performs the session tasks, and for each repository changed (umbrella and any submodules) creates a dedicated session branch on the corresponding user fork, pushes changes, and opens a separate pull request to the appropriate upstream repository/branch (umbrella canonical and submodule default/target branch). If the user has upstream write on any repo, they may push directly for that repo.

6. Real-time two-way messaging during session
   - Given a session is running,
   - When the backend/UI sends messages and the runner produces output messages/events,
   - Then both parties exchange messages over a real-time channel and all messages are persisted under the session’s path in project object storage.

7. UI synchronization with upstream
   - Given an RFE workflow is linked to upstream Git,
   - When changes are pushed by sessions or by external collaborators,
   - Then the UI can display current branch status and recent activity, and can trigger a refresh/sync from upstream.

8. RBAC-gated actions
9. Access and fork handling
   - Given a user lacks read access to the umbrella or a submodule,
   - When they browse files in the UI,
   - Then an access error is shown and actions are disabled for that repo.
   - And if the user lacks a fork of the umbrella repo,
   - Then the UI offers to create a fork before starting a session.
   - Given a user with only view permissions in the project namespace,
   - When they attempt to start a session or run Specify,
   - Then the action is blocked with an authorization error, while repository browsing remains allowed.

### Edge Cases
- Storage unavailable or credentials invalid; project creation should fail with actionable errors and no partial resources left.
- Session started with missing or inaccessible input/output repo/branch; session should fail fast with clear diagnostics.
- Branch creation conflicts or push denied due to permissions; session should surface errors and provide remediation guidance.
- Message channel interruption; messaging should auto-reconnect and persist unsent messages when connectivity returns.
- Large artifacts/logs; object storage paths must handle size limits and pagination for retrieval.
- Concurrent sessions on the same workflow; isolation guaranteed via per-pod PVCs and distinct session branches.
- Governance/compliance requirements for data retention and encryption [NEEDS CLARIFICATION].
 - Submodule access missing; runner proceeds with partial checkout, flags `incomplete-submodules`, and includes remediation checklist in PR.

---

## Requirements (mandatory)

### Functional Requirements
- FR-001: Projects MUST be able to choose a storage backend at creation time: Managed Object Storage (provisioned per project) or External S3-compatible storage (user-provided).
- FR-002: The system MUST register the selected storage backend with the backend service for subsequent reads/writes.
- FR-003: The prior per-project shared PVC model MUST be removed; no shared cross-pod writable PVCs are used for messaging or content proxying.
- FR-004: Each runner session pod MUST use its own PVC as an ephemeral working directory for compute and Git operations.
- FR-005: Sessions MUST accept an input repository and branch and an output repository and branch as parameters.
- FR-006: On session start, the runner MUST sync input repo/branch into its PVC working directory, perform work, and then push changes to the specified output repo/branch.
- FR-007: Sessions MUST create or use a clearly named session branch (e.g., rfe_<workflowId>/session/<sessionId>) for changes prior to PR creation.
 
 - FR-008: System MUST create pull requests for each repository changed during a session: one PR to the umbrella upstream canonical branch and separate PRs to each changed submodule’s upstream repository/target branch.
- FR-009: An umbrella upstream Git repository MUST exist and be authoritative; the system ensures the canonical branch `rfe/{workspaceSlug}` exists, sessions clone from this branch, and session outputs are pushed to user-selected forks for PRs back to upstream.
- FR-009a: Each workspace MUST bind to exactly one upstream `org/repo` and canonical branch `rfe/{workspaceSlug}`; this binding MUST be immutable post-creation unless an explicit migration process is executed.
- FR-009b: Users with upstream write MAY push directly to `rfe/{workspaceSlug}`; others MUST use PRs from personal forks. Sessions default to PR flow.
- FR-010: Backend↔Runner MUST support real-time, bidirectional messaging for inputs (prompts, commands) and outputs (logs, events, artifacts metadata).
- FR-011: All session messages MUST be durably persisted in project object storage under a predictable path.
- FR-012: The UI MUST reflect the latest upstream state and session outcomes, including branch and PR status, via provider webhooks or periodic sync.
- FR-013: The system MUST provide a deterministic object storage layout for sessions.
- FR-014: Access control MUST be enforced via three Kubernetes roles in each project namespace: `ambient-project-admin`, `ambient-project-edit`, and `ambient-project-view` (see `components/manifests/rbac`).
- FR-014a: Role capabilities:
  - `ambient-project-admin`: create/delete workspaces; configure storage; set canonical branch; manage credentials policies; run Specify; start/terminate sessions; view all; manage RBAC bindings.
  - `ambient-project-edit`: start sessions; run Specify; view sessions/messages; cannot change storage or RBAC.
  - `ambient-project-view`: view UI, specs, session logs and PR links; cannot mutate.
- FR-014b: Backend service accounts (`backend-sa`, `operator-sa`) MUST operate with least-privilege ClusterRoles provided under `components/manifests/rbac` for controller actions only.
- FR-015: User GitHub credentials MUST NOT be stored. Only short‑lived GitHub App installation tokens are minted per session, injected via ephemeral namespace‑scoped K8s Secrets, and deleted on completion. Storage credentials (e.g., S3) MUST be short‑lived and never persisted.
- FR-015c: The system MUST obtain per-user GitHub installation tokens via a GitHub App installed by the user on their account; no organization-wide app is required or assumed.
- FR-015d: The backend MUST maintain a secure mapping of SSO user → {githubUserId, installationId(s), host}; mint short‑lived installation tokens per session, inject only ephemeral tokens into runner Secrets, and never persist long‑lived tokens in namespaces.
- FR-015a: Submodules under `repos/*` MAY include external third-party repositories; session launch MUST validate user token access to each required submodule and fail fast with actionable diagnostics if access is missing.
- FR-019: PRs into `rfe/{workspaceSlug}` SHOULD use merge commits to preserve session branch context; if repository settings prevent merge commits, the system MUST either fall back to an allowed merge type (squash or rebase) or error clearly with remediation guidance.
- FR-016: The system MUST provide observable status for sessions (queued, running, succeeded, failed) and messaging health.
- FR-018: The UI MUST expose project storage selection, validation, and (for managed storage) lifecycle state.
 - FR-020: The UI MUST display access errors for umbrella/submodule repos when the user lacks permissions and disable file actions for those repos.
 - FR-021: The system MUST provide a fork creation flow (UI + backend) for the umbrella repo when the user lacks a fork and intends to start a session.
 - FR-022: The session start API MUST allow optional input/output parameters for sessions not tied to an RFE workspace (defaults may be empty).
 - FR-023: The system MUST support multiple runner types via a standardized Runner Shell + Adapter interface (e.g., claude, openai, localexec) selectable per session.
 - FR-024: All runner messaging MUST conform to a common JSON protocol (see runner-shell.md) and be durably persisted to S3/MinIO under `sessions/{sessionId}/messages.json` irrespective of runner type.
 - FR-024a: Runners MUST support streamed partial messages for large outputs; each message includes `seq` (monotonic), and partial fragments carry `partial.id`, `partial.index`, and `partial.total` to allow client reassembly.

### Non-Functional Requirements
- NFR-001: Messaging latency SHOULD target sub-1s p50 for text events at typical load [NEEDS CLARIFICATION: target scale].
- NFR-002: Storage operations SHOULD be idempotent and resilient to transient failures with retries.
- NFR-003: Data at rest MUST be encrypted in object storage; data in transit MUST use TLS [NEEDS CLARIFICATION: encryption keys/CMK].
- NFR-004: The system SHOULD support concurrent sessions at project scale without cross-session interference.
- NFR-005: Retention is customer-managed. The system does not auto-delete session messages or artifacts; bucket owners control lifecycle in S3/MinIO.
 
 - NFR-007: When submodules are skipped due to missing access, PR descriptions MUST include a checklist of inaccessible submodules and recommended remediation.

### Storage Layout (reference)
- Bucket root: `sessions/`
  - `<session_id>/`
    - `messages.json` (ordered append-only or paginated messages)
    - `artifacts/` (optional; session outputs metadata or files)

### UI and Synchronization
- The UI SHOULD display current workflow branch, session branches, and PR links.
- The UI SHOULD offer a manual “Sync from upstream” action and show last sync time.
- The UI SHOULD render real-time session messages and gracefully recover from reconnects.
 - The UI SHOULD group and display multiple PRs per session (umbrella + submodules), showing per-repo status and combined session status.
 - The UI SHOULD reflect RBAC: disable or hide actions a user cannot perform based on `view`/`edit`/`admin` role resolution.

### Open Questions / Clarifications
- Storage quotas, HA characteristics, and backup/restore expectations for managed object storage.
- Authentication/authorization model for backend, runner, and UI roles.
- Secret management location, rotation policy, and scoping.
- Message retention policy and pagination/segmentation strategy for large sessions.
- Target scale (projects, workflows, concurrent sessions) and performance SLOs.

---

## Key Entities
- Project: A tenant-scoped container defining storage backend and governance.
- StorageBackend: Configuration pointing to Managed Object Storage or external S3-compatible storage (bucket, region, credentials ref).
- RFEWorkflow: A feature planning workspace tied to an umbrella upstream Git repository with a canonical branch `rfe/{workspaceSlug}`; sessions clone from canonical and push to user forks.
- Session: An execution instance with parameters for input repo/branch and output repo/branch and status lifecycle.
- RepoReference: Logical pointer to a Git remote and its access credentials reference.
- BranchReference: Specific branch names for input and output operations.
- Message: A discrete event exchanged between backend/UI and runner during a session, persisted to storage.
- PullRequestLink: Reference to the created PR for session outputs.
 - RunnerType: The adapter identifier for a session (e.g., "claude", "openai", "localexec").

---

## Review & Acceptance Checklist

### Content Quality
- [ ] No unnecessary implementation details (stack-specific)
- [ ] Focused on user value and business outcomes
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

### Requirement Completeness
- [ ] No unresolved [NEEDS CLARIFICATION] markers
- [ ] Requirements are testable and unambiguous  
- [ ] Success criteria are measurable
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

---

## Execution Status
- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed

---
