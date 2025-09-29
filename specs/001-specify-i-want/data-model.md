# Data Model

## Entities

### Workspace
- id: string (UUID)
- workspaceSlug: string (kebab-case)
- upstreamRepoUrl: string
- canonicalBranch: string (format: rfe/{workspaceSlug})
- specifyFeatureSlug: string (folder under specs/)
- s3Bucket: string
- s3Prefix: string
- createdByUserId: string (SSO subject)
- createdAt: datetime

### Session
- id: string (UUID)
- workspaceId: string → Workspace.id
- userId: string (SSO subject)
- inputRepoUrl: string (umbrella repo)
- inputBranch: string (canonical by default)
- outputRepoUrl: string (user fork)
- outputBranch: string (rfe/{workspaceSlug}/session-{id})
- status: enum [queued, running, succeeded, failed]
- flags: array ["incomplete-submodules"]
- prLinks: array<PRLink>
- runnerType: string (enum: claude, openai, localexec)
- startedAt: datetime
- finishedAt: datetime|null

### PRLink
- repoUrl: string
- branch: string
- targetBranch: string
- url: string
- status: enum [open, merged, closed]

### StorageMessageLog
- sessionId: string → Session.id
- s3Path: string (sessions/{sessionId}/messages.json)
- messageCount: int
- lastUpdated: datetime

### SSOToGitHubMapping
- ssoUserId: string (subject)
- githubUserId: string
- installationIds: array<string>
- host: string (e.g., github.com)
- updatedAt: datetime

### RepoSubmodule
- workspaceId: string → Workspace.id
- path: string (repos/{name})
- url: string
- required: boolean
- lastResolvedSha: string|null

## Relationships
- Workspace 1—* Session
- Workspace 1—* RepoSubmodule
- Session 1—* PRLink
- Session 1—1 StorageMessageLog
- SSOToGitHubMapping 1—* Session (by user)
