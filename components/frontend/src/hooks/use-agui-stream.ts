'use client'

/**
 * AG-UI Event Stream Hook
 *
 * EventSource-based hook for consuming AG-UI events from the backend.
 * Uses the same-origin SSE proxy to bypass browser EventSource auth limitations.
 *
 * Reference: https://docs.ag-ui.com/concepts/events
 * Reference: https://docs.ag-ui.com/concepts/messages
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EventType,
  isRunStartedEvent,
  isRunFinishedEvent,
  isRunErrorEvent,
  isTextMessageStartEvent,
  isTextMessageContentEvent,
  isTextMessageEndEvent,
  isToolCallStartEvent,
  isToolCallEndEvent,
  isStateSnapshotEvent,
  isMessagesSnapshotEvent,
  isActivitySnapshotEvent,
} from '@/types/agui'
import type {
  AGUIClientState,
  PlatformEvent,
  PlatformMessage,
  PlatformToolCall,
  PlatformActivity,
  PlatformActivityPatch,
  AGUIMetaEvent,
} from '@/types/agui'

/**
 * Normalize MESSAGES_SNAPSHOT data for the internal PlatformMessage format.
 *
 * The runner sends snapshots where sub-agent child tool results appear as
 * separate flat role=tool messages instead of nested toolCalls entries with
 * parentToolUseId on the assistant message.
 *
 * This function nests child tool messages under their parent tool call so
 * the page rendering code (which builds hierarchy from parentToolUseId)
 * works correctly for both live-streamed and snapshot-restored sessions.
 *
 * Note: Since we now use the @ag-ui/core ToolCall format natively
 * ({type:"function", function:{name, arguments}}), no format conversion
 * is needed — snapshots already arrive in the correct format.
 */
function normalizeSnapshotMessages(snapshotMessages: PlatformMessage[]): PlatformMessage[] {
  // Shallow-clone messages so we can mutate toolCalls arrays safely
  const messages = snapshotMessages.map(m => ({
    ...m,
    toolCalls: m.toolCalls ? [...m.toolCalls] : undefined,
  }))

  // Step 1: Identify parent tool call IDs from assistant messages' toolCalls
  const parentToolCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.id) parentToolCallIds.add(tc.id)
      }
    }
  }

  if (parentToolCallIds.size === 0) return messages

  // Step 2: Find parent tool result message indices
  const parentResultIndex = new Map<string, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'tool' && 'toolCallId' in msg && msg.toolCallId && parentToolCallIds.has(msg.toolCallId)) {
      parentResultIndex.set(msg.toolCallId, i)
    }
  }

  // Step 3: Nest child tool messages under their parent tool call
  const indicesToRemove = new Set<number>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'tool' || !('toolCallId' in msg) || !msg.toolCallId) continue

    if (parentToolCallIds.has(msg.toolCallId)) {
      // This is a parent tool result — move content to the parent's toolCall.result
      const parentId = msg.toolCallId
      for (const assistantMsg of messages) {
        if (assistantMsg.role !== 'assistant' || !assistantMsg.toolCalls) continue
        const parentTC = assistantMsg.toolCalls.find(tc => tc.id === parentId)
        if (parentTC) {
          parentTC.result = ('content' in msg ? msg.content : '') as string || ''
          if (!parentTC.status) parentTC.status = 'completed'
          indicesToRemove.add(i)
          break
        }
      }
      continue
    }

    // This is potentially a child tool result.
    // Find the nearest parent whose result message comes AFTER this child.
    let bestParentId: string | null = null
    let bestParentResultIdx = Infinity
    for (const [parentId, resultIdx] of parentResultIndex) {
      if (resultIdx > i && resultIdx < bestParentResultIdx) {
        bestParentId = parentId
        bestParentResultIdx = resultIdx
      }
    }
    if (!bestParentId) continue

    // Verify this child appears after the assistant message that owns the parent
    let isAfterAssistant = false
    for (let a = i - 1; a >= 0; a--) {
      if (messages[a].role === 'assistant' &&
          messages[a].toolCalls?.some(tc => tc.id === bestParentId)) {
        isAfterAssistant = true
        break
      }
    }
    if (!isAfterAssistant) continue

    // Add child as a toolCalls entry with parentToolUseId on the assistant message
    for (const assistantMsg of messages) {
      if (assistantMsg.role !== 'assistant' || !assistantMsg.toolCalls) continue
      if (!assistantMsg.toolCalls.some(tc => tc.id === bestParentId)) continue

      if (!assistantMsg.toolCalls.some(tc => tc.id === msg.toolCallId)) {
        assistantMsg.toolCalls.push({
          id: msg.toolCallId,
          type: 'function',
          function: {
            name: ('name' in msg ? msg.name : null) as string || 'tool',
            arguments: '',
          },
          result: ('content' in msg ? msg.content : '') as string || '',
          status: 'completed',
          parentToolUseId: bestParentId,
        })
      }
      indicesToRemove.add(i)
      break
    }
  }

  // Step 4: Remove nested messages from top level
  return messages.filter((_, idx) => !indicesToRemove.has(idx))
}

type UseAGUIStreamOptions = {
  projectName: string
  sessionName: string
  runId?: string
  autoConnect?: boolean
  onEvent?: (event: PlatformEvent) => void
  onMessage?: (message: PlatformMessage) => void
  onError?: (error: string) => void
  onConnected?: () => void
  onDisconnected?: () => void
  onTraceId?: (traceId: string) => void  // Called when Langfuse trace_id is received
}

type UseAGUIStreamReturn = {
  state: AGUIClientState
  connect: (runId?: string) => void
  disconnect: () => void
  sendMessage: (content: string) => Promise<void>
  interrupt: () => Promise<void>
  isConnected: boolean
  isStreaming: boolean
  isRunActive: boolean
}

  const initialState: AGUIClientState = {
    threadId: null,
    runId: null,
    status: 'idle',
    messages: [],
    state: {},
    activities: [],
    currentMessage: null,
    currentToolCall: null,  // DEPRECATED: kept for backward compat
    pendingToolCalls: new Map(),  // NEW: tracks ALL in-progress tool calls
    pendingChildren: new Map(),
    error: null,
    messageFeedback: new Map(),  // Track feedback for messages
  }

export function useAGUIStream(options: UseAGUIStreamOptions): UseAGUIStreamReturn {
  // Track hidden message IDs (auto-sent initial/workflow prompts)
  const hiddenMessageIdsRef = useRef<Set<string>>(new Set())
  const {
    projectName,
    sessionName,
    runId: initialRunId,
    autoConnect = false,
    onEvent,
    onMessage,
    onError,
    onConnected,
    onDisconnected,
    onTraceId,
  } = options

  const [state, setState] = useState<AGUIClientState>(initialState)
  const [isRunActive, setIsRunActive] = useState(false)
  const currentRunIdRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const mountedRef = useRef(false)

  // Exponential backoff config for reconnection
  const MAX_RECONNECT_DELAY = 30000 // 30 seconds max
  const BASE_RECONNECT_DELAY = 1000 // 1 second base

  // Track mounted state without causing re-renders
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Process incoming AG-UI events
  const processEvent = useCallback(
    (event: PlatformEvent) => {
      onEvent?.(event)

      setState((prev) => {
        const newState = { ...prev }

        if (isRunStartedEvent(event)) {
          newState.threadId = event.threadId
          newState.runId = event.runId
          newState.status = 'connected'
          newState.error = null

          // Track active run
          currentRunIdRef.current = event.runId
          setIsRunActive(true)

          return newState
        }

        if (isRunFinishedEvent(event)) {
          newState.status = 'completed'

          // Mark run as inactive
          if (currentRunIdRef.current === event.runId) {
            setIsRunActive(false)
            currentRunIdRef.current = null
          }

          // Flush any pending message
          if (newState.currentMessage?.content) {
            const msg = {
              id: newState.currentMessage.id || crypto.randomUUID(),
              role: 'assistant' as const,
              content: newState.currentMessage.content,
              timestamp: String(event.timestamp ?? ''),
            } as PlatformMessage
            newState.messages = [...newState.messages, msg]
            onMessage?.(msg)
          }
          newState.currentMessage = null
          return newState
        }

        if (isRunErrorEvent(event)) {
          newState.status = 'error'
          // Core RunErrorEvent uses 'message' field, not 'error'
          newState.error = event.message
          onError?.(event.message)

          // Mark run as inactive on error
          // RunErrorEvent doesn't have runId in core; use ref
          setIsRunActive(false)
          currentRunIdRef.current = null

          return newState
        }

        if (isTextMessageStartEvent(event)) {
          newState.currentMessage = {
            id: event.messageId || null,
            role: event.role,
            content: '',
            timestamp: String(event.timestamp ?? ''),
          }
          return newState
        }

        if (isTextMessageContentEvent(event)) {
          if (newState.currentMessage) {
            // Create a NEW object so React detects the change and re-renders
            newState.currentMessage = {
              ...newState.currentMessage,
              content: (newState.currentMessage.content || '') + event.delta,
            }
          }
          return newState
        }

        if (isTextMessageEndEvent(event)) {
          if (newState.currentMessage?.content) {
            const messageId = newState.currentMessage.id || crypto.randomUUID();

            // Skip hidden messages (auto-sent initial/workflow prompts)
            if (hiddenMessageIdsRef.current.has(messageId)) {
              newState.currentMessage = null;
              return newState;
            }

            // Check if this message already exists (e.g., from MESSAGES_SNAPSHOT)
            const existingIndex = newState.messages.findIndex(m => m.id === messageId);

            if (existingIndex >= 0) {
              // Message exists - update content if different (don't duplicate)
              const existingMsg = newState.messages[existingIndex];
              if (existingMsg.content !== newState.currentMessage.content) {
                const updatedMessages = [...newState.messages];
                updatedMessages[existingIndex] = {
                  ...existingMsg,
                  content: newState.currentMessage.content,
                } as PlatformMessage;
                newState.messages = updatedMessages;
              }
            } else {
              // Message doesn't exist - create new
              const msg = {
                id: messageId,
                role: newState.currentMessage.role || 'assistant',
                content: newState.currentMessage.content,
                timestamp: String(event.timestamp ?? ''),
              } as PlatformMessage
              newState.messages = [...newState.messages, msg]
              onMessage?.(msg)
            }
          }
          newState.currentMessage = null
          // Don't clear currentToolCall - tool calls might come after TEXT_MESSAGE_END
          return newState
        }

        if (isToolCallStartEvent(event)) {
          // AG-UI spec: parentMessageId links tool call to the assistant message that invoked it
          // Runner may also send parent_tool_call_id (snake_case) for hierarchical nesting
          const parentToolId = (event as unknown as { parent_tool_call_id?: string }).parent_tool_call_id;
          const parentMessageId = event.parentMessageId;

          // Determine effective parent tool ID for hierarchy.
          // AG-UI sub-agents set parentMessageId to the PARENT TOOL CALL ID,
          // so if parentMessageId matches a known tool call, treat it as a parent-child relationship.
          let effectiveParentToolId = parentToolId;
          if (!effectiveParentToolId && parentMessageId) {
            if (newState.pendingToolCalls.has(parentMessageId)) {
              effectiveParentToolId = parentMessageId;
            } else {
              for (let i = newState.messages.length - 1; i >= 0; i--) {
                if (newState.messages[i].toolCalls?.some(tc => tc.id === parentMessageId)) {
                  effectiveParentToolId = parentMessageId;
                  break;
                }
              }
            }
          }

          // Store in pendingToolCalls Map to support parallel tool calls
          const updatedPending = new Map(newState.pendingToolCalls);
          updatedPending.set(event.toolCallId, {
            id: event.toolCallId,
            name: event.toolCallName || 'unknown_tool',
            args: '',
            parentToolUseId: effectiveParentToolId,
            parentMessageId: parentMessageId,
            timestamp: String(event.timestamp ?? ''),
          });
          newState.pendingToolCalls = updatedPending;

          // Also update currentToolCall for backward compat (UI rendering)
          newState.currentToolCall = {
            id: event.toolCallId,
            name: event.toolCallName,
            args: '',
            parentToolUseId: effectiveParentToolId,
          }
          return newState
        }

        if (event.type === EventType.TOOL_CALL_ARGS) {
          const typedEvent = event as { toolCallId: string; delta: string }
          const toolCallId = typedEvent.toolCallId;
          const existing = newState.pendingToolCalls.get(toolCallId);

          if (existing) {
            // Update the pending tool call in Map
            const updatedPending = new Map(newState.pendingToolCalls);
            updatedPending.set(toolCallId, {
              ...existing,
              args: (existing.args || '') + typedEvent.delta,
            });
            newState.pendingToolCalls = updatedPending;
          }

          // Also update currentToolCall for backward compat (if it's the same tool)
          if (newState.currentToolCall?.id === toolCallId) {
            newState.currentToolCall = {
              ...newState.currentToolCall,
              args: (newState.currentToolCall.args || '') + typedEvent.delta,
            }
          }
          return newState
        }

        if (isToolCallEndEvent(event)) {
          const toolCallId = event.toolCallId || newState.currentToolCall?.id || crypto.randomUUID()

          // Get tool info from pendingToolCalls Map (supports parallel tool calls)
          const pendingTool = newState.pendingToolCalls.get(toolCallId);
          const toolCallName = pendingTool?.name || newState.currentToolCall?.name || 'unknown_tool'
          const toolCallArgs = pendingTool?.args || newState.currentToolCall?.args || ''
          const parentToolUseId = pendingTool?.parentToolUseId || newState.currentToolCall?.parentToolUseId
          // AG-UI spec: parentMessageId links this tool call to its assistant message
          const parentMessageId = pendingTool?.parentMessageId

          // Defense in depth: Check if this tool already exists
          const toolAlreadyExists = newState.messages.some(msg =>
            msg.toolCalls?.some(tc => tc.id === toolCallId)
          );

          if (toolAlreadyExists) {
            const updatedPendingTools = new Map(newState.pendingToolCalls);
            updatedPendingTools.delete(toolCallId);
            newState.pendingToolCalls = updatedPendingTools;
            if (newState.currentToolCall?.id === toolCallId) {
              newState.currentToolCall = null;
            }
            return newState;
          }

          // Create completed tool call using @ag-ui/core ToolCall format
          const completedToolCall: PlatformToolCall = {
            id: toolCallId,
            type: 'function',
            function: {
              name: toolCallName,
              arguments: toolCallArgs,
            },
            result: undefined as string | undefined,
            status: 'completed' as const,
            parentToolUseId: parentToolUseId,
          }

          const messages = [...newState.messages]

          // Remove from pendingToolCalls Map
          const updatedPendingTools = new Map(newState.pendingToolCalls);
          updatedPendingTools.delete(toolCallId);
          newState.pendingToolCalls = updatedPendingTools;

          // If this tool has a parent tool (hierarchical nesting), try to attach to it
          if (parentToolUseId) {
            let foundParent = false

            // Check if parent is still pending (streaming, not finished yet)
            if (newState.pendingToolCalls.has(parentToolUseId)) {
              const updatedPending = new Map(newState.pendingChildren);
              const pending = updatedPending.get(parentToolUseId) || []
              updatedPending.set(parentToolUseId, [...pending, {
                id: crypto.randomUUID(),
                role: 'tool',
                toolCallId: toolCallId,
                content: '',
                toolCalls: [completedToolCall],
              } as PlatformMessage])
              newState.pendingChildren = updatedPending;
              if (newState.currentToolCall?.id === toolCallId) {
                newState.currentToolCall = null;
              }
              return newState
            }

            // Search for parent tool in messages
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].toolCalls) {
                const parentToolIdx = messages[i].toolCalls!.findIndex(tc => tc.id === parentToolUseId)
                if (parentToolIdx !== -1) {
                  const childExists = messages[i].toolCalls!.some(tc => tc.id === toolCallId);
                  if (!childExists) {
                    messages[i] = {
                      ...messages[i],
                      toolCalls: [...(messages[i].toolCalls || []), completedToolCall]
                    }
                  }
                  foundParent = true
                  break
                }
              }
            }

            if (foundParent) {
              newState.messages = messages
              if (newState.currentToolCall?.id === toolCallId) {
                newState.currentToolCall = null;
              }
              return newState
            }
          }

          // Attach to the correct assistant message.
          // AG-UI spec: use parentMessageId to find the exact assistant message.
          // Fallback: search backwards for the last assistant message.
          let foundAssistant = false
          for (let i = messages.length - 1; i >= 0; i--) {
            const isTargetMessage = parentMessageId
              ? messages[i].id === parentMessageId
              : messages[i].role === 'assistant'

            if (isTargetMessage) {
              const existingToolCalls = messages[i].toolCalls || []

              if (existingToolCalls.some(tc => tc.id === toolCallId)) {
                foundAssistant = true;
                break;
              }

              const pendingForThisTool = newState.pendingChildren.get(toolCallId) || []
              const childToolCalls = pendingForThisTool.flatMap(child => child.toolCalls || [])

              messages[i] = {
                ...messages[i],
                toolCalls: [...existingToolCalls, completedToolCall, ...childToolCalls]
              }

              if (pendingForThisTool.length > 0) {
                const updatedPending = new Map(newState.pendingChildren);
                updatedPending.delete(toolCallId);
                newState.pendingChildren = updatedPending;
              }

              foundAssistant = true
              break
            }
          }

          // If target message not found, add as standalone tool message
          if (!foundAssistant) {
            const toolMessage = {
              id: crypto.randomUUID(),
              role: 'tool' as const,
              content: '',
              toolCallId: toolCallId,
              toolCalls: [completedToolCall],
              timestamp: String(event.timestamp ?? ''),
            } as PlatformMessage
            messages.push(toolMessage)
          }

          newState.messages = messages
          newState.currentToolCall = null
          return newState
        }

        // Handle TOOL_CALL_RESULT — the runner sends results as a separate event
        // after TOOL_CALL_END (which may have no result field).
        if (event.type === EventType.TOOL_CALL_RESULT) {
          const typedEvent = event as { toolCallId: string; content: string }
          const toolCallId = typedEvent.toolCallId
          const resultContent = typedEvent.content || ''
          if (toolCallId) {
            let found = false

            // Search in committed messages first
            const messages = [...newState.messages]
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].toolCalls) {
                const tcIdx = messages[i].toolCalls!.findIndex(tc => tc.id === toolCallId)
                if (tcIdx >= 0) {
                  const updatedToolCalls = [...messages[i].toolCalls!]
                  updatedToolCalls[tcIdx] = {
                    ...updatedToolCalls[tcIdx],
                    result: resultContent,
                    status: 'completed',
                  }
                  messages[i] = { ...messages[i], toolCalls: updatedToolCalls }
                  newState.messages = messages
                  found = true
                  break
                }
              }
            }

            // If not found, search in pendingChildren (child tools waiting for parent to finish)
            if (!found && newState.pendingChildren.size > 0) {
              const updatedPendingChildren = new Map(newState.pendingChildren)
              for (const [parentId, children] of updatedPendingChildren) {
                for (let j = 0; j < children.length; j++) {
                  if (children[j].toolCalls) {
                    const tcIdx = children[j].toolCalls!.findIndex(tc => tc.id === toolCallId)
                    if (tcIdx >= 0) {
                      const updatedChildren = [...children]
                      const updatedToolCalls = [...updatedChildren[j].toolCalls!]
                      updatedToolCalls[tcIdx] = {
                        ...updatedToolCalls[tcIdx],
                        result: resultContent,
                        status: 'completed',
                      }
                      updatedChildren[j] = { ...updatedChildren[j], toolCalls: updatedToolCalls }
                      updatedPendingChildren.set(parentId, updatedChildren)
                      newState.pendingChildren = updatedPendingChildren
                      found = true
                      break
                    }
                  }
                }
                if (found) break
              }
            }
          }
          return newState
        }

        if (isStateSnapshotEvent(event)) {
          newState.state = event.snapshot as Record<string, unknown>
          return newState
        }

        if (event.type === EventType.STATE_DELTA) {
          // Apply state patches
          const typedEvent = event as { delta: Array<{ op: string; path: string; value?: unknown }> }
          const stateClone = { ...newState.state }
          for (const patch of typedEvent.delta) {
            const key = patch.path.startsWith('/') ? patch.path.slice(1) : patch.path
            if (patch.op === 'add' || patch.op === 'replace') {
              stateClone[key] = patch.value
            } else if (patch.op === 'remove') {
              delete stateClone[key]
            }
          }
          newState.state = stateClone
          return newState
        }

        if (isMessagesSnapshotEvent(event)) {

          // Filter out hidden messages from snapshot
          const visibleMessages = (event.messages as PlatformMessage[]).filter(msg => {
            const isHidden = hiddenMessageIdsRef.current.has(msg.id)
            return !isHidden
          })

          // Normalize snapshot: reconstruct parent-child tool call hierarchy
          // (sub-agents). Without this, child tool results appear as flat
          // separate messages instead of nested.
          const normalizedMessages = normalizeSnapshotMessages(visibleMessages)

          // Merge normalized snapshot into existing messages while preserving
          // chronological order.  The runner may send partial snapshots (current
          // run only, not cumulative), so we can't just replace.
          const snapshotMap = new Map(normalizedMessages.map(m => [m.id, m]))
          const existingIds = new Set(newState.messages.map(m => m.id))

          // Update existing messages in-place with snapshot data.
          // For assistant messages with toolCalls, merge tool call arrays to
          // preserve names/args from streaming events that the snapshot lacks.
          const merged: PlatformMessage[] = newState.messages.map(msg => {
            const snapshotVersion = snapshotMap.get(msg.id)
            if (!snapshotVersion) return msg

            // For assistant messages, merge toolCalls to preserve streaming data
            if (msg.role === 'assistant' && msg.toolCalls?.length && snapshotVersion.toolCalls?.length) {
              const mergedToolCalls = [...snapshotVersion.toolCalls]
              for (const existingTC of msg.toolCalls) {
                const snapshotTC = mergedToolCalls.find(tc => tc.id === existingTC.id)
                if (snapshotTC) {
                  // Prefer existing tool name if snapshot only has generic name
                  if (existingTC.function.name && existingTC.function.name !== 'tool' &&
                      (!snapshotTC.function.name || snapshotTC.function.name === 'tool')) {
                    (snapshotTC as PlatformToolCall).function = {
                      ...snapshotTC.function,
                      name: existingTC.function.name,
                    }
                  }
                  // Prefer existing args if snapshot has none
                  if (existingTC.function.arguments && !snapshotTC.function.arguments) {
                    (snapshotTC as PlatformToolCall).function = {
                      ...snapshotTC.function,
                      arguments: existingTC.function.arguments,
                    }
                  }
                  // Preserve parentToolUseId from either source
                  if (existingTC.parentToolUseId && !snapshotTC.parentToolUseId) {
                    (snapshotTC as PlatformToolCall).parentToolUseId = existingTC.parentToolUseId
                  }
                } else {
                  // Existing tool call not in snapshot — keep it
                  mergedToolCalls.push(existingTC)
                }
              }
              return { ...snapshotVersion, toolCalls: mergedToolCalls }
            }

            return snapshotVersion
          })

          // Insert new snapshot messages at the correct position based on
          // the snapshot's ordering. For each new message, find the next
          // message in the snapshot that already exists in state and insert
          // before it. This prevents user messages from being appended after
          // assistant messages when the snapshot has them in [user, assistant] order.
          for (let i = 0; i < normalizedMessages.length; i++) {
            const msg = normalizedMessages[i]
            if (existingIds.has(msg.id)) continue // Already in merged

            // Find the next snapshot message that exists in the merged list
            let insertBeforeId: string | null = null
            for (let j = i + 1; j < normalizedMessages.length; j++) {
              if (existingIds.has(normalizedMessages[j].id)) {
                insertBeforeId = normalizedMessages[j].id
                break
              }
            }

            if (insertBeforeId) {
              const idx = merged.findIndex(m => m.id === insertBeforeId)
              if (idx >= 0) {
                merged.splice(idx, 0, msg)
              } else {
                merged.push(msg)
              }
            } else {
              merged.push(msg)
            }
            existingIds.add(msg.id)
          }

          // Recover tool names from streaming state before cleanup.
          // The snapshot's role=tool messages don't carry tool names, but
          // the streaming events stored them in standalone messages' toolCalls
          // arrays and in pendingToolCalls.  Extract them first so we can
          // enrich the normalized toolCalls entries that default to 'tool'.
          const toolNameMap = new Map<string, string>()
          for (const msg of merged) {
            if (msg.role === 'tool' && msg.toolCalls) {
              for (const tc of msg.toolCalls) {
                if (tc.id && tc.function.name && tc.function.name !== 'tool' && tc.function.name !== 'unknown_tool') {
                  toolNameMap.set(tc.id, tc.function.name)
                }
              }
            }
          }
          for (const [id, pending] of newState.pendingToolCalls) {
            if (pending.name && pending.name !== 'tool' && pending.name !== 'unknown_tool') {
              toolNameMap.set(id, pending.name)
            }
          }
          // Apply recovered names to normalized toolCalls
          for (const msg of merged) {
            if (msg.role === 'assistant' && msg.toolCalls) {
              for (const tc of msg.toolCalls) {
                if ((!tc.function.name || tc.function.name === 'tool' || tc.function.name === 'unknown_tool') &&
                    toolNameMap.has(tc.id)) {
                  (tc as PlatformToolCall).function = {
                    ...tc.function,
                    name: toolNameMap.get(tc.id)!,
                  }
                }
              }
            }
          }

          // Remove redundant standalone role=tool messages that are now nested
          // in an assistant message's toolCalls (from normalization).  Without
          // this cleanup, the standalone messages' toolCalls arrays (which lack
          // parentToolUseId) overwrite the normalized entries in page.tsx's
          // allToolCalls map, destroying the parent-child hierarchy.
          const nestedToolCallIds = new Set<string>()
          for (const msg of merged) {
            if (msg.role === 'assistant' && msg.toolCalls) {
              for (const tc of msg.toolCalls) {
                nestedToolCallIds.add(tc.id)
              }
            }
          }
          newState.messages = merged.filter(msg => {
            if (msg.role !== 'tool') return true
            // Remove if this message's toolCallId is already in an assistant's toolCalls
            if ('toolCallId' in msg && msg.toolCallId && nestedToolCallIds.has(msg.toolCallId)) return false
            // Remove if any of its embedded toolCalls overlap with nested IDs
            if (msg.toolCalls?.some(tc => nestedToolCallIds.has(tc.id))) return false
            return true
          })
          // Clear pendingChildren — the normalized snapshot subsumes any
          // pending child data from streaming, preventing duplicate children
          // when page.tsx builds the hierarchy from multiple sources.
          newState.pendingChildren = new Map()
          return newState
        }

        if (isActivitySnapshotEvent(event)) {
          // Platform uses array-based activities; cast from wire format
          const activities = (event as unknown as { activities?: PlatformActivity[] }).activities
          if (activities) {
            newState.activities = activities
          }
          return newState
        }

        if (event.type === EventType.ACTIVITY_DELTA) {
          // Platform uses array-based activity patches
          const patches = (event as unknown as { delta: PlatformActivityPatch[] }).delta
          if (patches) {
            const activitiesClone = [...newState.activities]
            for (const patch of patches) {
              if (patch.op === 'add') {
                activitiesClone.push(patch.activity)
              } else if (patch.op === 'update') {
                const idx = activitiesClone.findIndex((a) => a.id === patch.activity.id)
                if (idx >= 0) {
                  activitiesClone[idx] = patch.activity
                }
              } else if (patch.op === 'remove') {
                const idx = activitiesClone.findIndex((a) => a.id === patch.activity.id)
                if (idx >= 0) {
                  activitiesClone.splice(idx, 1)
                }
              }
            }
            newState.activities = activitiesClone
          }
          return newState
        }

        // Handle STEP events
        if (event.type === EventType.STEP_STARTED) {
          // Core StepStartedEvent has stepName (no stepId)
          const typedEvent = event as { stepName: string }
          newState.state = {
            ...newState.state,
            currentStep: {
              id: typedEvent.stepName,
              name: typedEvent.stepName,
              status: 'running',
            },
          }
          return newState
        }

        if (event.type === EventType.STEP_FINISHED) {
          // Clear current step
          const stateClone = { ...newState.state }
          delete stateClone.currentStep
          newState.state = stateClone
          return newState
        }

        // Handle RAW events (may contain message data or thinking blocks)
        if (event.type === EventType.RAW) {
          // RAW events use "event" field (AG-UI standard), or "data" field (legacy)
          type RawEventData = { event?: Record<string, unknown>; data?: Record<string, unknown> }
          const rawEvent = event as unknown as RawEventData
          const rawData = rawEvent.event || rawEvent.data

          // Handle message metadata (for hiding auto-sent messages)
          if (rawData?.type === 'message_metadata' && rawData?.hidden) {
            const messageId = rawData.messageId as string
            if (messageId) {
              hiddenMessageIdsRef.current.add(messageId)
              // Remove the message if it was already added (race condition)
              newState.messages = newState.messages.filter(m => m.id !== messageId)
            }
            return newState
          }

          // Handle Langfuse trace_id for feedback association
          if (rawData?.type === 'langfuse_trace' && rawData?.traceId) {
            const traceId = rawData.traceId as string
            onTraceId?.(traceId)
            return newState
          }

          const actualRawData = rawData

          // Handle thinking blocks from Claude SDK
          if (actualRawData?.type === 'thinking_block') {
            const msg = {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: actualRawData.thinking as string || '',
              metadata: {
                type: 'thinking_block',
                thinking: actualRawData.thinking as string,
                signature: actualRawData.signature as string,
              },
              timestamp: String(event.timestamp ?? ''),
            } as PlatformMessage
            newState.messages = [...newState.messages, msg]
            onMessage?.(msg)
            return newState
          }

          // Handle user message echoes from backend
          if (actualRawData?.role === 'user' && actualRawData?.content) {
            // Check if this message already exists or is hidden (auto-sent prompts)
            const messageId = (actualRawData.id as string) || crypto.randomUUID()
            const exists = newState.messages.some(m => m.id === messageId)
            const isHidden = hiddenMessageIdsRef.current.has(messageId)
            if (!exists && !isHidden) {
              const msg = {
                id: messageId,
                role: 'user' as const,
                content: actualRawData.content as string,
                timestamp: String(event.timestamp ?? ''),
              } as PlatformMessage
              newState.messages = [...newState.messages, msg]
              onMessage?.(msg)
            }
            return newState
          }

          // Handle other message data
          if (actualRawData?.role && actualRawData?.content) {
            const msg = {
              id: (actualRawData.id as string) || crypto.randomUUID(),
              role: actualRawData.role as string,
              content: actualRawData.content as string,
              timestamp: String(event.timestamp ?? ''),
            } as PlatformMessage
            newState.messages = [...newState.messages, msg]
            onMessage?.(msg)
          }
          return newState
        }

        // Handle META events (user feedback: thumbs_up / thumbs_down)
        if (event.type === 'META') {
          const metaEvent = event as AGUIMetaEvent
          const metaType = metaEvent.metaType
          const messageId = metaEvent.payload?.messageId as string | undefined

          if (messageId && (metaType === 'thumbs_up' || metaType === 'thumbs_down')) {
            const feedbackMap = new Map(newState.messageFeedback)
            feedbackMap.set(messageId, metaType)
            newState.messageFeedback = feedbackMap
          }
          return newState
        }

        return newState
      })
    },
    [onEvent, onMessage, onError, onTraceId],
  )

  // Connect to the AG-UI event stream
  const connect = useCallback(
    (runId?: string) => {
      // Disconnect existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }

      setState((prev) => ({
        ...prev,
        status: 'connecting',
        error: null,
      }))

      // Build SSE URL through Next.js proxy
      let url = `/api/projects/${encodeURIComponent(projectName)}/agentic-sessions/${encodeURIComponent(sessionName)}/agui/events`
      if (runId) {
        url += `?runId=${encodeURIComponent(runId)}`
      }

      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        // Reset reconnect attempts on successful connection
        reconnectAttemptsRef.current = 0
        setState((prev) => ({
          ...prev,
          status: 'connected',
        }))
        onConnected?.()
      }

      eventSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as PlatformEvent
          processEvent(event)
        } catch (err) {
          console.error('Failed to parse AG-UI event:', err)
        }
      }

      eventSource.onerror = () => {
        // IMPORTANT: Close the EventSource immediately to prevent browser's native reconnect
        // from firing alongside our custom reconnect logic
        eventSource.close()

        // Only proceed if this is still our active EventSource
        if (eventSourceRef.current !== eventSource) {
          return
        }
        eventSourceRef.current = null

        // Don't reconnect if component is unmounted
        if (!mountedRef.current) {
          return
        }

        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'Connection error',
        }))
        onError?.('Connection error')
        onDisconnected?.()

        // Clear any existing reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
        reconnectAttemptsRef.current++
        const delay = Math.min(
          BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current - 1),
          MAX_RECONNECT_DELAY
        )

        console.log(`[useAGUIStream] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`)

        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connect(runId)
          }
        }, delay)
      }
    },
    [projectName, sessionName, processEvent, onConnected, onError, onDisconnected],
  )

  // Disconnect from the event stream
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setState((prev) => ({
      ...prev,
      status: 'idle',
    }))
    setIsRunActive(false)
    currentRunIdRef.current = null
    onDisconnected?.()
  }, [onDisconnected])

  // Interrupt the current run (stop Claude mid-execution)
  const interrupt = useCallback(
    async () => {
      const runId = currentRunIdRef.current
      if (!runId) {
        console.warn('[useAGUIStream] No active run to interrupt')
        return
      }

      try {
        const interruptUrl = `/api/projects/${encodeURIComponent(projectName)}/agentic-sessions/${encodeURIComponent(sessionName)}/agui/interrupt`

        const response = await fetch(interruptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
        })

        if (!response.ok) {
          throw new Error(`Failed to interrupt: ${response.statusText}`)
        }

        // Mark run as inactive immediately (backend will send RUN_FINISHED or RUN_ERROR)
        setIsRunActive(false)
        currentRunIdRef.current = null

      } catch (error) {
        console.error('[useAGUIStream] Interrupt failed:', error)
        throw error
      }
    },
    [projectName, sessionName],
  )

  // Send a message to start/continue the conversation
  // AG-UI server pattern: POST returns SSE stream directly
  const sendMessage = useCallback(
    async (content: string) => {
      // Send to backend via run endpoint - this returns an SSE stream
      const runUrl = `/api/projects/${encodeURIComponent(projectName)}/agentic-sessions/${encodeURIComponent(sessionName)}/agui/run`

      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content,
      }

      // Add user message to state immediately for instant UI feedback.
      // This prevents ordering issues when MESSAGES_SNAPSHOT arrives later
      // (the snapshot merge will find this message by ID and update in-place
      // rather than appending it after the assistant message).
      setState((prev) => ({
        ...prev,
        status: 'connected',
        error: null,
        messages: [...prev.messages, {
          ...userMessage,
          timestamp: new Date().toISOString(),
        } as PlatformMessage],
      }))

      try {
        const response = await fetch(runUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            threadId: state.threadId || sessionName,
            parentRunId: state.runId,
            messages: [userMessage],
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`[useAGUIStream] /agui/run error: ${errorText}`)
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: errorText,
          }))
          setIsRunActive(false)
          throw new Error(`Failed to send message: ${errorText}`)
        }

        // AG-UI middleware pattern: POST creates run and returns metadata immediately
        // Events are broadcast to GET /agui/events subscribers (avoid concurrent streams)
        const result = await response.json()

        // Mark run as active and track runId
        if (result.runId) {
          currentRunIdRef.current = result.runId
          setIsRunActive(true)
        }

        // Ensure we're connected to the thread stream to receive events.
        // Check the EventSource ref directly instead of state.status to avoid
        // stale closure issues (state.status may still be 'completed' from the
        // previous run, which would cause an unnecessary reconnect and replay
        // of all past events — producing a visible flash of old messages).
        if (!eventSourceRef.current) {
          connect()
        }
      } catch (error) {
        console.error(`[useAGUIStream] sendMessage error:`, error)
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
        throw error
      }
    },
    [projectName, sessionName, state.threadId, state.runId, connect],
  )

  // Auto-connect on mount if enabled (client-side only)
  const autoConnectAttemptedRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return // Skip during SSR
    if (autoConnectAttemptedRef.current) return // Only auto-connect once

    if (autoConnect && mountedRef.current) {
      autoConnectAttemptedRef.current = true
      connect(initialRunId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect])

  return {
    state,
    connect,
    disconnect,
    sendMessage,
    interrupt,
    isConnected: state.status === 'connected',
    isStreaming: state.currentMessage !== null || state.currentToolCall !== null || state.pendingToolCalls.size > 0,
    isRunActive,
  }
}
