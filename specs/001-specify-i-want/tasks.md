# Tasks: Runner–Backend Messaging and Storage Overhaul for RFE Workflows

Repo: /Users/gkrumbac/Documents/vTeam | Feature: 001-specify-i-want

## Conventions
- [P] = can run in parallel
- TDD: write tests/contracts before implementation

## Tasks

T001. Initialize backend GitHub App user-install flow (backend)
- Path: components/backend/
- Add endpoints to link SSO user to GitHub installation (store githubUserId, installationId)
- Dependency: None

T002. Implement short-lived installation token minting (backend)
- Path: components/backend/
- Mint per-session token; return to orchestrator for Secret injection
- Dependency: T001

T003. Add RBAC enforcement for view/edit/admin roles (backend)
- Path: components/backend/
- Enforce ambient-project-view/edit/admin on sensitive actions
- Dependency: None

T004. Implement workspace creation API (POST /workspaces) and logic
- Path: components/backend/
- Ensure canonical branch rfe/{workspaceSlug} exists; bootstrap structure; persist pointers
- Dependency: T002, T003

T005. Implement Specify run API (POST /workspaces/{id}/specify)
- Path: components/backend/
- Checkout canonical; run specify; commit/push using invoking user token or fork+PR
- Dependency: T004

T006. Implement session start API (POST /workspaces/{id}/sessions)
- Path: components/backend/
- Create per-session Secret with git creds; launch runner job; record session
- Dependency: T002, T004

T007. WebSocket messaging channel backend↔runner
- Path: components/backend/
- Two-way stream; append messages to S3
- Dependency: T006

T008. PR creation logic per repo (umbrella + submodules)
- Path: components/backend/
- Detect changed repos; create forks/branches as needed; open PRs per repo
- Dependency: T006

T009. UI: Connect GitHub and fork selector
- Path: components/frontend/
- Flow to install app, show user forks, choose push target
- Dependency: T001

T010. UI: Repo browser (tree/blob, submodules)
- Path: components/frontend/
- Backend-proxied GitHub API; ETag caching; submodule resolution
- Dependency: T004

T011. UI: Sessions dashboard with grouped PRs
- Path: components/frontend/
- Show umbrella + submodule PRs per session; live status via WS
- Dependency: T007, T008

T012. Contracts: define endpoints (OpenAPI) [P]
- Path: specs/001-specify-i-want/contracts/api.yaml
- Expand schemas and responses for all new endpoints
- Dependency: None

T013. Data model: finalize entities [P]
- Path: specs/001-specify-i-want/data-model.md
- Ensure fields cover auth mapping, sessions, PR links, submodules
- Dependency: None

T014. Quickstart: validation steps [P]
- Path: specs/001-specify-i-want/quickstart.md
- Add concrete curl examples and WS test steps
- Dependency: None

T015. Backend tests: contract tests for APIs
- Path: components/backend/
- Tests for workspace create, specify run, session start, messages
- Dependency: T012

T016. Backend: implement endpoints per contracts
- Path: components/backend/
- Implement with TDD to satisfy tests
- Dependency: T015

T017. Runner: session script updates
- Path: components/runners/claude-code-runner/
- Clone upstream canonical; create per-repo branches; push; send PR intents
- Dependency: T006, T008

T018. Observability: metrics and audit logs
- Path: components/backend/
- Metrics for WS latency, PR creation; audit token issuance and actions
- Dependency: T016, T007

T019. RBAC manifests review [P]
- Path: components/manifests/rbac/
- Validate roles match FR-014/014a/014b; adjust if needed
- Dependency: None

T020. Performance hardening and rate-limit handling
- Path: components/backend/
- ETag caching; retries/backoff; pagination
- Dependency: T016

## Parallel groups
- Group A [P]: T012, T013, T014, T019
- Group B [P]: T009 after T001; T010 after T004

## Done criteria
- All endpoints pass contract tests; sessions open PRs per repo; WS stable with persisted logs; UI shows grouped PRs; RBAC enforced; documentation updated.
