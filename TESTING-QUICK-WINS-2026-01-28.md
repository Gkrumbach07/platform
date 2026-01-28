# Testing Instructions: Quick Wins Batch (2026-01-28)

## Overview

This testing branch combines 7 quick win PRs into a single deployable package. All PRs have been rebased on `ambient-code/platform main` and merged together.

**Branch:** `testing/quick-wins-batch-2026-01-28`  
**Pushed to:** https://github.com/Gkrumbach07/platform (redirects from vTeam fork)

---

## Successfully Merged PRs (7 total)

| PR | Jira | Type | Files Changed | Description |
|----|------|------|---------------|-------------|
| #532 | RHOAIENG-39110 | Bug | `app/api/me/route.ts` | Strip cluster suffix from username |
| #533 | RHOAIENG-39106 | Bug | `components/ui/message.tsx` | Make URLs clickable |
| #534 | RHOAIENG-46361 | Bug | `components/ui/message.tsx` | Monospace font for chat |
| #537 | RHOAIENG-41580 | Bug | `MessagesTab.tsx`, `page.tsx` | Remove duplicate End Session button |
| #538 | RHOAIENG-39116 | Bug | `page.tsx`, `artifacts-accordion.tsx` | Remove nested accordion |
| #542 | RHOAIENG-46360 | Bug | `services/queries/use-sessions.ts` | Optimistic session deletion |
| #546 | RHOAIENG-39096 | Bug | `services/queries/use-projects.ts` | Optimistic project deletion |

---

## PRs With Merge Conflicts (Needs Individual Attention)

| PR | Jira | Conflict Reason |
|----|------|-----------------|
| #535 | RHOAIENG-39115 | Backend `content.go` - upstream changes to same area |
| #536 | RHOAIENG-39117 | Multi-component (runner + frontend + backend) - complex |
| #543 | RHOAIENG-46523 | Backend `permissions.go` - needs careful RBAC review |
| #544 | RHOAIENG-45393 | Frontend `page.tsx` - major layout restructure with panels |
| #545 | RHOAIENG-46350 | Frontend - depends on layout changes |

---

## Build & Deploy Instructions

### 1. Build Images

```bash
cd /Users/gkrumbac/Documents/vTeam
git checkout testing/quick-wins-batch-2026-01-28

# Build frontend (requires podman/docker running)
make build-frontend CONTAINER_ENGINE=podman REGISTRY=quay.io/gkrumbach07 PLATFORM=linux/amd64

# Push to quay
make push-frontend CONTAINER_ENGINE=podman REGISTRY=quay.io/gkrumbach07

# Rollout
oc rollout restart deployment/frontend -n ambient-code
oc rollout status deployment/frontend -n ambient-code --timeout=120s
```

---

## Testing Checklist

### ✅ PR #532: Username Display (RHOAIENG-39110)

**What Changed:** Username in top-right navbar strips `@cluster.local` suffix

**Test Steps:**
1. Navigate to https://ambient-code.apps.gkrumbac.dev.datahub.redhat.com
2. Check username in top-right corner
3. **Expected:** Shows `kube:admin` (or just username without @cluster.local)
4. **Verify:** Clean display, no cluster suffix

**Pass Criteria:** Username shows without cluster domain suffix

---

### ✅ PR #533: URLs Clickable (RHOAIENG-39106)

**What Changed:** URLs in chat messages render as clickable hyperlinks

**Test Steps:**
1. Open any session: https://ambient-code.apps.gkrumbac.dev.datahub.redhat.com/projects/test-project
2. Send a message with a URL (or check existing messages with URLs):
   - Example: "Check out https://github.com/ambient-code/platform"
   - Example: "See https://issues.redhat.com/browse/RHOAIENG-39106"
3. **Expected:** URL appears as blue underlined link
4. Click the URL
5. **Expected:** Opens in new tab with proper security (noopener noreferrer)

**Pass Criteria:** 
- URLs are visually distinct (blue, underlined)
- URLs are clickable
- Opens in new tab

---

### ✅ PR #534: Monospace Font (RHOAIENG-46361)

**What Changed:** Chat messages use monospace font (input box unchanged)

**Test Steps:**
1. Open any session
2. Look at chat messages from Claude
3. **Expected:** Messages display in monospace font (looks like code editor)
4. Check the input textarea at bottom
5. **Expected:** Input box still uses normal sans-serif font

**Pass Criteria:**
- Chat messages use monospace font
- Input box remains sans-serif
- Code blocks still render correctly

---

### ✅ PR #537: Remove Duplicate Button (RHOAIENG-41580)

**What Changed:** Removed duplicate "End Session" button from chat area

**Test Steps:**
1. Open any running session
2. Scroll to bottom of chat interface
3. **Expected:** No "End Session" button in chat area
4. Look at session header (top right)
5. **Expected:** "Stop Session" button still present
6. Click "Stop Session"
7. **Expected:** Session stops successfully

**Pass Criteria:**
- Only ONE stop/end button exists (in header)
- No confusion about which button to use
- Stop functionality still works

---

### ✅ PR #538: Nested Accordion (RHOAIENG-39116)

**What Changed:** Removed unnecessary nested accordion in file explorer

**Test Steps:**
1. Open any session
2. Expand "Artifacts" section in left panel
3. **Expected:** File tree displays directly, no nested accordion
4. Click on a file
5. **Expected:** File opens/displays correctly

**Pass Criteria:**
- File tree renders cleanly without extra nesting
- File navigation works
- Visual appearance is cleaner

---

### ✅ PR #542: Session Deletion (RHOAIENG-46360)

**What Changed:** Optimistic update for session deletion - immediate UI response

**Test Steps:**
1. Go to sessions list
2. Click delete on a session
3. **Expected:** Confirmation dialog appears
4. Click OK/Confirm
5. **Expected:** Session disappears from list IMMEDIATELY (no delay)
6. **Verify:** No "waiting" state, instant removal

**Pass Criteria:**
- Session disappears instantly from UI
- No 2-3 second delay
- No loading spinner after clicking OK

---

### ✅ PR #546: Projects Race Condition (RHOAIENG-39096)

**What Changed:** Optimistic update prevents "not found" error when deleting projects quickly

**Test Steps:**
1. Create 2 test workspaces
2. Delete first workspace
3. **IMMEDIATELY** delete second workspace (click delete button rapidly)
4. **Expected:** Both deletions succeed, no error messages
5. **Verify:** No "project not found" error appears

**Pass Criteria:**
- Can delete multiple projects rapidly
- No errors appear
- Both projects removed cleanly

---

## Additional Notes

### Frontend-Only Changes
All 7 merged PRs are frontend-only changes. No backend or operator changes needed for this batch.

### Remaining Complex PRs (Test Separately)

**RHOAIENG-39115 (Command ordering):**
- Backend change in `content.go`
- Has conflicts with upstream
- Needs individual merge and backend rebuild/deploy

**RHOAIENG-39117 (System messages):**
- Multi-component (Runner + Frontend + Backend)
- Requires AG-UI event implementation
- Complex change, test separately

**RHOAIENG-46523 (system:authenticated):**
- Backend RBAC validation change
- Security-sensitive, needs careful review
- Test separately with proper RBAC verification

**RHOAIENG-45393 (Left panel):**
- Major layout restructure
- Conflicts with current layout
- Requires design review and extensive testing

**RHOAIENG-46350 (Paste images):**
- Depends on layout/upload infrastructure
- May conflict with other changes
- Test separately

---

## Quick Build Commands (When Engines Running)

```bash
# In vTeam directory
git checkout testing/quick-wins-batch-2026-01-28

# Build & push
make build-frontend CONTAINER_ENGINE=podman REGISTRY=quay.io/gkrumbach07 PLATFORM=linux/amd64
make push-frontend CONTAINER_ENGINE=podman REGISTRY=quay.io/gkrumbach07

# Deploy
oc rollout restart deployment/frontend -n ambient-code
oc rollout status deployment/frontend -n ambient-code

# Test using browser at:
# https://ambient-code.apps.gkrumbac.dev.datahub.redhat.com
```

---

## Summary

**Ready for Testing:** 7 PRs (all frontend)  
**Needs Individual Attention:** 5 PRs (backend + complex frontend)

Test the 7 merged PRs first, then tackle the complex ones individually with proper conflict resolution and targeted testing.
