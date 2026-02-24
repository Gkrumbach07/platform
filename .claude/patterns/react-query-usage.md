# React Query Usage Patterns

Standard patterns for data fetching, mutations, and cache management in the frontend.

## Core Principles

1. **ALL data fetching uses React Query** - No manual `fetch()` in components
2. **Queries for reads** - `useQuery` for GET operations
3. **Mutations for writes** - `useMutation` for POST/PUT/DELETE
4. **Cache invalidation** - Invalidate queries after mutations
5. **Optimistic updates** - Update UI before server confirms

## File Structure

```
src/services/
├── api/                    # API client layer (pure functions)
│   ├── sessions.ts         # sessionApi.list(), .create(), .delete()
│   ├── projects.ts
│   └── common.ts           # Shared fetch logic, error handling
└── queries/                # React Query hooks
    ├── sessions.ts         # useSessions(), useCreateSession()
    ├── projects.ts
    └── common.ts           # Query client config
```

**Separation of concerns:**

- `api/`: Pure API functions (no React, no hooks)
- `queries/`: React Query hooks that use API functions

## Pattern 1: Query Hook (List Resources)

```typescript
// services/queries/sessions.ts
import { useQuery } from "@tanstack/react-query"
import { sessionApi } from "@/services/api/sessions"

export function useSessions(projectName: string) {
  return useQuery({
    queryKey: ["sessions", projectName],
    queryFn: () => sessionApi.list(projectName),
    staleTime: 5000,          // Consider data fresh for 5s
    refetchInterval: 10000,   // Poll every 10s for updates
  })
}
```

**Usage in component:**

```typescript
// app/projects/[projectName]/sessions/page.tsx
'use client'

import { useSessions } from "@/services/queries/sessions"

export function SessionsList({ projectName }: { projectName: string }) {
  const { data: sessions, isLoading, error } = useSessions(projectName)

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>
  if (!sessions?.length) return <div>No sessions found</div>

  return (
    <div>
      {sessions.map(session => (
        <SessionCard key={session.metadata.name} session={session} />
      ))}
    </div>
  )
}
```

**Key points:**

- `queryKey` includes all parameters that affect the query
- `staleTime` prevents unnecessary refetches
- `refetchInterval` for polling (optional)
- Destructure `data`, `isLoading`, `error` for UI states

## Pattern 2: Query Hook (Single Resource)

```typescript
// services/queries/sessions.ts
export function useSession(projectName: string, sessionName: string) {
  return useQuery({
    queryKey: ["sessions", projectName, sessionName],
    queryFn: () => sessionApi.get(projectName, sessionName),
    enabled: !!sessionName,  // Only run if sessionName provided
    staleTime: 3000,
  })
}
```

**Key points:**

- `enabled: !!sessionName` prevents query if parameter missing
- More specific queryKey for targeted cache invalidation

## Pattern 3: Create Mutation with Optimistic Update

```typescript
// services/queries/sessions.ts
import { useMutation, useQueryClient } from "@tanstack/react-query"

export function useCreateSession(projectName: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateSessionRequest) =>
      sessionApi.create(projectName, data),

    // Optimistic update: show immediately before server confirms
    onMutate: async (newSession) => {
      // Cancel any outgoing refetches (prevent overwriting optimistic update)
      await queryClient.cancelQueries({
        queryKey: ["sessions", projectName]
      })

      // Snapshot current value
      const previousSessions = queryClient.getQueryData([
        "sessions",
        projectName
      ])

      // Optimistically update cache
      queryClient.setQueryData(
        ["sessions", projectName],
        (old: AgenticSession[] | undefined) => [
          ...(old || []),
          {
            metadata: { name: newSession.name },
            spec: newSession,
            status: { phase: "Pending" },  // Optimistic status
          },
        ]
      )

      // Return context with snapshot
      return { previousSessions }
    },

    // Rollback on error
    onError: (err, variables, context) => {
      queryClient.setQueryData(
        ["sessions", projectName],
        context?.previousSessions
      )

      // Show error toast/notification
      console.error("Failed to create session:", err)
    },

    // Refetch after success (get real data from server)
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["sessions", projectName]
      })
    },
  })
}
```

**Usage:**

```typescript
// components/sessions/create-session-dialog.tsx
'use client'

import { useCreateSession } from "@/services/queries/sessions"
import { Button } from "@/components/ui/button"

export function CreateSessionDialog({ projectName }: { projectName: string }) {
  const createSession = useCreateSession(projectName)

  const handleSubmit = (data: CreateSessionRequest) => {
    createSession.mutate(data)
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <Button
        type="submit"
        disabled={createSession.isPending}
      >
        {createSession.isPending ? "Creating..." : "Create Session"}
      </Button>
    </form>
  )
}
```

**Key points:**

- `onMutate`: Optimistic update (runs before server call)
- `onError`: Rollback on failure
- `onSuccess`: Invalidate queries to refetch real data
- Use `isPending` for loading states

## Pattern 4: Delete Mutation

```typescript
// services/queries/sessions.ts
export function useDeleteSession(projectName: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionName: string) =>
      sessionApi.delete(projectName, sessionName),

    // Optimistic delete
    onMutate: async (sessionName) => {
      await queryClient.cancelQueries({
        queryKey: ["sessions", projectName]
      })

      const previousSessions = queryClient.getQueryData([
        "sessions",
        projectName
      ])

      // Remove from cache
      queryClient.setQueryData(
        ["sessions", projectName],
        (old: AgenticSession[] | undefined) =>
          old?.filter(s => s.metadata.name !== sessionName) || []
      )

      return { previousSessions }
    },

    onError: (err, sessionName, context) => {
      queryClient.setQueryData(
        ["sessions", projectName],
        context?.previousSessions
      )
    },

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["sessions", projectName]
      })
    },
  })
}
```

## Pattern 5: Polling Until Condition Met

```typescript
// services/queries/use-sessions.ts
import type { AgenticSession, AgenticSessionPhase } from "@/types/api/sessions"

// IMPORTANT: Always define phase lists using AgenticSessionPhase to prevent
// typos and to stay in sync with the canonical type definition.
// Cross-check against AgenticSessionPhase in types/api/sessions.ts to confirm
// completeness whenever you add or change a phase list.
const TERMINAL_PHASES: AgenticSessionPhase[] = ["Stopped", "Completed", "Failed"]

// Define intervals as named constants - do not scatter magic numbers across hooks
const POLL_INTERVALS_MS = {
  TRANSITIONING: 1000,  // Pending, Creating, Stopping
  RUNNING: 5000,        // Running
  AGGRESSIVE: 500,      // Desired-phase annotation pending
} as const

export function useSessionWithPolling(
  projectName: string,
  sessionName: string
) {
  return useQuery({
    queryKey: sessionKeys.detail(projectName, sessionName),
    queryFn: () => sessionsApi.getSession(projectName, sessionName),
    // Add retry with exponential backoff alongside polling
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    refetchInterval: (query) => {
      // Pause polling when tab is not visible (avoid wasting resources)
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return false
      }

      // Stop polling after retries are exhausted (error state)
      if (query.state.status === "error") {
        return false
      }

      const session = query.state.data as AgenticSession | undefined
      const phase = session?.status?.phase

      // Stop polling for terminal phases
      if (phase && TERMINAL_PHASES.includes(phase)) {
        return false
      }

      // Use typed phase comparisons, not hardcoded strings
      const isTransitioning: AgenticSessionPhase[] = ["Pending", "Creating", "Stopping"]
      if (phase && isTransitioning.includes(phase)) {
        return POLL_INTERVALS_MS.TRANSITIONING
      }

      if (phase === "Running") {
        return POLL_INTERVALS_MS.RUNNING
      }

      return POLL_INTERVALS_MS.TRANSITIONING  // Default for unknown/undefined phase
    },
  })
}
```

**Key points:**

- Import and use `AgenticSessionPhase` from `@/types/api/sessions` — never hard-code phase strings
- Verify phase lists against the canonical type; TypeScript will catch missing/misspelled values
- Return `false` to stop polling; return number (ms) to continue
- Add `retry` + `retryDelay` (exponential backoff) alongside `refetchInterval`
- Stop polling on error state after retries exhausted
- Check `document.visibilityState` to avoid polling hidden tabs
- Define interval constants in one place rather than scattering magic numbers

## API Client Layer Pattern

```typescript
// services/api/sessions.ts
import { API_BASE_URL } from "@/config"
import type { AgenticSession, CreateSessionRequest } from "@/types/session"

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = getAuthToken()  // From auth context or storage

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || "Request failed")
  }

  return response.json()
}

export const sessionApi = {
  list: async (projectName: string): Promise<AgenticSession[]> => {
    const data = await fetchWithAuth(
      `${API_BASE_URL}/projects/${projectName}/agentic-sessions`
    )
    return data.items || []
  },

  get: async (
    projectName: string,
    sessionName: string
  ): Promise<AgenticSession> => {
    return fetchWithAuth(
      `${API_BASE_URL}/projects/${projectName}/agentic-sessions/${sessionName}`
    )
  },

  create: async (
    projectName: string,
    data: CreateSessionRequest
  ): Promise<AgenticSession> => {
    return fetchWithAuth(
      `${API_BASE_URL}/projects/${projectName}/agentic-sessions`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    )
  },

  delete: async (projectName: string, sessionName: string): Promise<void> => {
    return fetchWithAuth(
      `${API_BASE_URL}/projects/${projectName}/agentic-sessions/${sessionName}`,
      {
        method: "DELETE",
      }
    )
  },
}
```

**Key points:**

- Shared `fetchWithAuth` for token injection
- Pure functions (no React, no hooks)
- Type-safe inputs and outputs
- Centralized error handling

## Polling Best Practices

These requirements apply any time you add `refetchInterval` to a query hook.

### 1. Use `AgenticSessionPhase` for Phase Comparisons

The canonical session phase type is `AgenticSessionPhase` in `components/frontend/src/types/api/sessions.ts`:

```typescript
type AgenticSessionPhase =
  | 'Pending' | 'Creating' | 'Running'
  | 'Stopping' | 'Stopped' | 'Completed' | 'Failed'
```

**Always import this type** when checking phases. TypeScript will flag misspelled or outdated values:

```typescript
// ❌ BAD - hard-coded strings, prone to drift and typos
const nonStable = ['Pending', 'Creating', 'Stoping']  // typo!

// ✅ GOOD - type-checked, exhaustiveness verifiable
import type { AgenticSessionPhase } from "@/types/api/sessions"
const TRANSITIONING: AgenticSessionPhase[] = ["Pending", "Creating", "Stopping"]
```

When building a phase list (e.g., "non-stable states"), cross-check against `AgenticSessionPhase` to confirm no phases are missing before shipping.

### 2. Pause Polling for Hidden Tabs (Page Visibility API)

React Query does **not** automatically pause `refetchInterval` polling when a browser tab is hidden. Always check `document.visibilityState` to avoid wasting API quota and browser resources:

```typescript
refetchInterval: (query) => {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false  // Pause — tab is hidden
  }
  // ... rest of logic
}
```

The `typeof document !== "undefined"` guard is required for SSR compatibility.

### 3. Slow API Responses

React Query will **not** fire overlapping requests for the same query key. If the API response takes longer than the polling interval, the next poll is deferred until the current one completes. No additional handling is needed for this case.

### 4. Error Handling for Polling Queries

Always pair `refetchInterval` with `retry` and `retryDelay`. After retries are exhausted, stop polling rather than continuing to hammer a failing endpoint:

```typescript
useQuery({
  queryKey: [...],
  queryFn: ...,
  retry: 3,
  retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  refetchInterval: (query) => {
    if (query.state.status === "error") return false  // Retries exhausted - stop
    // ... phase-based logic
  },
})
```

React Query's retry config applies per-query; it is independent of the polling interval.

### 5. Define Interval Values as Named Constants

Do not scatter magic numbers across hook files. Define all polling intervals as named constants at the top of the hook file (or in a shared config):

```typescript
// At top of services/queries/use-sessions.ts
const POLL_INTERVALS_MS = {
  TRANSITIONING: 1000,  // Pending, Creating, Stopping
  RUNNING: 5000,        // Running
  AGGRESSIVE: 500,      // Desired-phase annotation present
} as const
```

This keeps intent clear and makes tuning easy from one place.

## Anti-Patterns (DO NOT USE)

### ❌ Manual fetch() in Components

```typescript
// NEVER DO THIS
const [sessions, setSessions] = useState([])

useEffect(() => {
  fetch('/api/sessions')
    .then(r => r.json())
    .then(setSessions)
}, [])
```

**Why wrong:** No caching, no automatic refetching, manual state management.
**Use instead:** React Query hooks.

### ❌ Not Using Query Keys Properly

```typescript
// BAD: Same query key for different data
useQuery({
  queryKey: ["sessions"],  // Missing projectName!
  queryFn: () => sessionApi.list(projectName),
})
```

**Why wrong:** Cache collisions, wrong data shown.
**Use instead:** Include all parameters in query key.

## Quick Reference

| Pattern | Hook | When to Use |
|---------|------|-------------|
| List resources | `useQuery` | GET /resources |
| Get single resource | `useQuery` | GET /resources/:id |
| Create resource | `useMutation` | POST /resources |
| Update resource | `useMutation` | PUT /resources/:id |
| Delete resource | `useMutation` | DELETE /resources/:id |
| Polling | `useQuery` + `refetchInterval` | Real-time updates |
| Optimistic update | `onMutate` | Instant UI feedback |
| Dependent query | `enabled` | Query depends on another |

## Validation Checklist

Before merging frontend code:

- [ ] All data fetching uses React Query (no manual fetch)
- [ ] Query keys include all relevant parameters
- [ ] Mutations invalidate related queries
- [ ] Loading and error states handled
- [ ] Optimistic updates for create/delete (where appropriate)
- [ ] API client layer is pure functions (no hooks)

**When adding polling (`refetchInterval`):**

- [ ] Phase comparisons use `AgenticSessionPhase` type — no raw string literals
- [ ] Phase lists verified as exhaustive against `AgenticSessionPhase` in `types/api/sessions.ts`
- [ ] `document.visibilityState` check added to pause polling on hidden tabs
- [ ] `retry` + `retryDelay` (exponential backoff) configured alongside `refetchInterval`
- [ ] Polling stops when `query.state.status === "error"` (retries exhausted)
- [ ] Polling intervals defined as named constants, not inline magic numbers
