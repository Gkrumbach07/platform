
# Implementation Plan: Runner–Backend Messaging and Storage Overhaul for RFE Workflows

**Branch**: `001-specify-i-want` | **Date**: 2025-09-26 | **Spec**: /Users/gkrumbac/Documents/vTeam/specs/001-specify-i-want/spec.md
**Input**: Feature specification from `/specs/001-specify-i-want/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
5. Execute Phase 0 → research.md
6. Execute Phase 1 → contracts, data-model.md, quickstart.md
7. Re-evaluate Constitution Check section
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

## Summary
Use an upstream umbrella repo per workspace with canonical branch `rfe/{workspaceSlug}`. Specify writes to `specs/{SPECIFY_FEATURE}` on canonical using the invoking user’s GitHub App installation token. Sessions clone upstream canonical, push to user forks, and open PRs to canonical; changes to submodules create separate PRs per repo. Prefer merge commits; if repo settings disallow, fall back to an allowed type or error with guidance. Messaging is over WebSocket with durable logs in S3; supports streamed partial messages for large outputs; UI browses upstream via backend proxy; RBAC uses ambient-project view/edit/admin.

## Technical Context
**Language/Version**: Go (backend), TypeScript/Next.js (frontend)  
**Primary Dependencies**: GitHub API, WebSockets, S3/MinIO, Kubernetes  
**Storage**: S3/MinIO for session messages/artifacts (sessions/*)  
**Testing**: go test, jest/vitest (frontend)  
**Target Platform**: OpenShift/Kubernetes  
**Project Type**: web (frontend + backend + operator)  
**Performance Goals**: WS p50 < 1s, PR creation < 5s  
**Constraints**: No shared RWO PVC across pods; no org GitHub App  
**Scale/Scope**: 100s of workspaces; 10s concurrent sessions/workspace

## Constitution Check
- Gate: Test-first and contracts present → OpenAPI added; quickstart includes validation steps.  
- Observability: session status and WS health required (FR-016).  
- Simplicity: avoid S3 repo mirror; keep upstream as source.

## Project Structure

### Documentation (this feature)
```
specs/001-specify-i-want/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── api.yaml
```

### Source Code (repository root)
```
components/
  backend/
    main.go
    handlers.go
  frontend/
    src/
  manifests/
    rbac/
  runners/
    claude-code-runner/
```

**Structure Decision**: Extend backend (Go) for per-user GitHub App installation-token flow (SSO↔GitHub mapping), session orchestration, PR creation, and WS; frontend for repo browsing and session UX; manifests for RBAC alignment.
Add Runner Shell + Adapter in runners to standardize messaging and support multiple runner types.

## Phase 0: Outline & Research
See research.md (created): decisions on auth, messaging, merge policy, and submodules.

## Phase 1: Design & Contracts
- Entities captured in data-model.md.
- Core endpoints in contracts/api.yaml.
- Quickstart outlines operational steps.
 - Runner shell design: see runner-shell.md (Shell + Adapter, protocol, transports, sink).

## Phase 2: Task Planning Approach
- Derive tasks from contracts and data model; create tasks.md in /tasks phase.

## Complexity Tracking
| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Multi‑repo PRs | Ownership boundaries | Single PR would cross repos |

## Progress Tracking
**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [x] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
