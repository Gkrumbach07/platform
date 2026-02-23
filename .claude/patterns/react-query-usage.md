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
// services/queries/sessions.ts
import type { AgenticSessionPhase } from "@/types/agentic-session"

// ✅ Define polling intervals as named constants — never hard-code inline
const POLL_INTERVAL_AGGRESSIVE_MS = 1000;  // Transitional states
const POLL_INTERVAL_NORMAL_MS = 5000;      // Active/running states

// ✅ Derive stable/terminal phase sets from the TypeScript type.
// When AgenticSessionPhase changes, TypeScript will flag missing cases here.
const TERMINAL_PHASES = new Set<AgenticSessionPhase>([
  'Stopped',
  'Completed',
  'Failed',
]);

const TRANSITIONAL_PHASES = new Set<AgenticSessionPhase>([
  'Pending',
  'Creating',
  'Stopping',
]);

export function useSessionWithPolling(
  projectName: string,
  sessionName: string
) {
  return useQuery({
    queryKey: ["sessions", projectName, sessionName],
    queryFn: () => sessionApi.get(projectName, sessionName),
    // ✅ Pause polling when browser tab is hidden (Page Visibility API)
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const session = query.state.data as AgenticSession | undefined

      // Stop polling for terminal phases
      if (!session?.status?.phase || TERMINAL_PHASES.has(session.status.phase)) {
        return false
      }

      // Poll aggressively during transitions
      if (TRANSITIONAL_PHASES.has(session.status.phase)) {
        return POLL_INTERVAL_AGGRESSIVE_MS
      }

      // Normal polling while running
      return POLL_INTERVAL_NORMAL_MS
    },
    // ✅ React Query retries failed requests 3 times with exponential backoff by default.
    // Override only if polling should stop sooner on persistent failures:
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  })
}
```

**Key points:**

- Extract polling intervals as named constants — never hard-code `2000` or `5000` inline
- `refetchIntervalInBackground: false` pauses polling when the browser tab is hidden, saving resources; set to `true` only when background updates are critical
- Derive phase groupings (`TERMINAL_PHASES`, `TRANSITIONAL_PHASES`) as typed `Set<AgenticSessionPhase>` so TypeScript catches any new phases added to the union type
- Return `false` to stop polling; return a number (ms) to continue
- React Query automatically stops `refetchInterval` when the query enters an error state after retries are exhausted — rely on this rather than adding custom error counters
- If the API is slower than the polling interval, React Query queues requests and skips intermediate polls; the interval timer restarts after each successful response, so overlapping requests are not a concern

## Polling: Known Limitations and Considerations

When implementing polling in any React Query hook, address the following explicitly or document why they are not applicable:

| Concern | React Query built-in | What to verify |
|---|---|---|
| Tab backgrounding | `refetchIntervalInBackground: false` stops polling when hidden | Set this option unless background updates are required |
| Request overlap (API slower than interval) | React Query waits for previous request before restarting the timer | No extra handling needed, but note this in comments |
| Repeated failures | `retry` + `retryDelay` with exponential backoff; polling stops after retries exhausted | Confirm `retry` count is appropriate for the use case |
| Exhaustive phase list | TypeScript union type `AgenticSessionPhase` in `src/types/agentic-session.ts` | Use `Set<AgenticSessionPhase>` to get compile-time exhaustiveness checking |
| Pagination during polling | `keepPreviousData` / `placeholderData` prevents layout shifts | Use `placeholderData: keepPreviousData` on paginated queries that also poll |

## Session Phase States

`AgenticSessionPhase` is defined in `src/types/agentic-session.ts` as a union type. **Always import and use this type** — never write phase strings ad-hoc:

```typescript
import type { AgenticSessionPhase } from "@/types/agentic-session"

// ✅ Typed constant — exhaustiveness is enforced by TypeScript
const NON_STABLE_PHASES = new Set<AgenticSessionPhase>([
  'Pending', 'Creating', 'Running', 'Stopping',
])

// ❌ Ad-hoc string — no compile-time safety, easy to typo or miss new states
if (phase === 'Pending' || phase === 'Creating' || phase === 'Running') { ... }
```

Current phases and their categories:

| Phase | Category | Notes |
|---|---|---|
| `Pending` | Transitional | Session submitted, not yet started |
| `Creating` | Transitional | Runner pod being created |
| `Running` | Active | Session is executing |
| `Stopping` | Transitional | Stop requested, draining |
| `Stopped` | Terminal | Stopped by user or inactivity |
| `Completed` | Terminal | Finished successfully |
| `Failed` | Terminal | Error or timeout |

If new phases are added to `AgenticSessionPhase`, TypeScript will surface errors at any `Set<AgenticSessionPhase>` site — use this to ensure polling logic stays in sync.

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
