"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Square, Trash2, Copy, Play, MoreVertical, Bot, Loader2, FolderTree, AlertCircle, Sprout, CheckCircle2, GitBranch, Edit, RefreshCw, Folder, FileText, Info } from "lucide-react";
import { useRouter } from "next/navigation";

// Custom components
import MessagesTab from "@/components/session/MessagesTab";
import ResultsTab from "@/components/session/ResultsTab";
import { EditRepositoriesDialog } from "../../rfe/[id]/edit-repositories-dialog";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CloneSessionDialog } from "@/components/clone-session-dialog";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { GitHubConnectionCard } from "@/components/github-connection-card";

import type { SessionMessage } from "@/types";
import type { MessageObject, ToolUseMessages, ToolUseBlock, ToolResultBlock } from "@/types/agentic-session";
import { getPhaseColor } from "@/utils/session-helpers";

// React Query hooks
import {
  useSession,
  useSessionMessages,
  useStopSession,
  useDeleteSession,
  useSendChatMessage,
  useSendControlMessage,
  useAllSessionGitHubDiffs,
  useSessionK8sResources,
  useContinueSession,
  useRfeWorkflow,
  useRfeWorkflowAgents,
  useRfeWorkflowSeeding,
  useSeedRfeWorkflow,
  useUpdateRfeWorkflow,
  useCreateRfeWorkflow,
  useGitHubStatus,
  useWorkflowArtifacts,
  rfeKeys,
} from "@/services/queries";
import { useSecretsValues } from "@/services/queries/use-secrets";
import { successToast, errorToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function ProjectSessionDetailPage({
  params,
}: {
  params: Promise<{ name: string; sessionName: string }>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [projectName, setProjectName] = useState<string>("");
  const [sessionName, setSessionName] = useState<string>("");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [backHref, setBackHref] = useState<string | null>(null);
  const [contentPodSpawning, setContentPodSpawning] = useState(false);
  const [contentPodReady, setContentPodReady] = useState(false);
  const [contentPodError, setContentPodError] = useState<string | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [editRepoDialogOpen, setEditRepoDialogOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("none");
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [specRepoUrl, setSpecRepoUrl] = useState("https://github.com/org/repo.git");
  const [baseBranch, setBaseBranch] = useState("main");
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>(["workflows"]);
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [contextUrl, setContextUrl] = useState("");
  const [contextBranch, setContextBranch] = useState("main");
  const [customWorkflowDialogOpen, setCustomWorkflowDialogOpen] = useState(false);
  const [customWorkflowUrl, setCustomWorkflowUrl] = useState("");
  const [customWorkflowBranch, setCustomWorkflowBranch] = useState("main");
  const [customWorkflowPath, setCustomWorkflowPath] = useState("");
  const [workflowLoading, setWorkflowLoading] = useState(false);

  // Extract params
  useEffect(() => {
    params.then(({ name, sessionName: sName }) => {
      setProjectName(name);
      setSessionName(sName);
      try {
        const url = new URL(window.location.href);
        setBackHref(url.searchParams.get("backHref"));
      } catch {}
    });
  }, [params]);

  // Open spec-repository accordion when plan-feature or develop-feature is selected
  useEffect(() => {
    if (selectedWorkflow === "plan-feature" || selectedWorkflow === "develop-feature") {
      setOpenAccordionItems(prev => {
        if (!prev.includes("spec-repository")) {
          return [...prev, "spec-repository"];
        }
        return prev;
      });
    }
  }, [selectedWorkflow]);

  // React Query hooks
  const { data: session, isLoading, error, refetch: refetchSession } = useSession(projectName, sessionName);
  const { data: messages = [] } = useSessionMessages(projectName, sessionName, session?.status?.phase);
  const { data: k8sResources } = useSessionK8sResources(projectName, sessionName);
  const { data: githubStatus } = useGitHubStatus();
  const { data: secretsValues } = useSecretsValues(projectName);
  const stopMutation = useStopSession();
  const deleteMutation = useDeleteSession();
  const continueMutation = useContinueSession();
  const sendChatMutation = useSendChatMessage();
  const sendControlMutation = useSendControlMessage();
  
  // Get RFE workflow ID from session if this is an RFE session
  const rfeWorkflowId = session?.metadata?.labels?.['rfe-workflow'];
  const { data: rfeWorkflow, refetch: refetchWorkflow } = useRfeWorkflow(projectName, rfeWorkflowId || '');
  const { data: repoAgents = [], isLoading: loadingAgents } = useRfeWorkflowAgents(
    projectName,
    rfeWorkflowId || ''
  );
  const { data: seedingData, isLoading: checkingSeeding, error: seedingQueryError, refetch: refetchSeeding } = useRfeWorkflowSeeding(
    projectName,
    rfeWorkflowId || ''
  );
  const seedWorkflowMutation = useSeedRfeWorkflow();
  const updateWorkflowMutation = useUpdateRfeWorkflow();
  const createWorkflowMutation = useCreateRfeWorkflow();
  
  // Fetch artifacts for the spec repository
  const { data: workflowArtifacts = [], isLoading: artifactsLoading, refetch: refetchArtifacts } = useWorkflowArtifacts(
    projectName,
    rfeWorkflowId || ''
  );

  // Workspace state - removed unused tree/file management code

  // Handler to refresh spec repository artifacts
  const handleRefreshArtifacts = useCallback(async () => {
    if (!rfeWorkflowId) return;
    // Invalidate artifacts query to force fresh fetch
    await queryClient.invalidateQueries({
      queryKey: rfeKeys.artifacts(projectName, rfeWorkflowId),
    });
    await refetchArtifacts();
  }, [queryClient, projectName, rfeWorkflowId, refetchArtifacts]);

  // Handler for workflow selection
  const handleWorkflowChange = async (value: string) => {
    setSelectedWorkflow(value);
    
    if (value === "custom") {
      // Open custom workflow dialog
      setCustomWorkflowDialogOpen(true);
      return;
    }
    
    if (value === "none") {
      // No workflow selected, nothing to do
      return;
    }
    
    // Map OOTB workflows to their Git URLs
    const workflowUrls: Record<string, { gitUrl: string; branch: string; path?: string }> = {
      "spec-kit": {
        gitUrl: "https://github.com/ambient-code/spec-kit-template.git",
        branch: "main",
      },
      // "bug-fix": { gitUrl: "...", branch: "main" }, // TBD
    };
    
    const workflowConfig = workflowUrls[value];
    if (!workflowConfig) {
      errorToast(`Workflow ${value} not configured`);
      return;
    }
    
    // Call API to set workflow
    setWorkflowLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectName}/agentic-sessions/${sessionName}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gitUrl: workflowConfig.gitUrl,
          branch: workflowConfig.branch,
          path: workflowConfig.path || "",
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update workflow");
      }
      
      successToast(`Workflow "${value}" activated`);
      
      // Send WebSocket message to notify runner immediately
      try {
        await fetch(`/api/projects/${projectName}/agentic-sessions/${sessionName}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "workflow_change",
            gitUrl: workflowConfig.gitUrl,
            branch: workflowConfig.branch,
            path: workflowConfig.path || "",
          }),
        });
      } catch (err) {
        console.warn("Failed to notify runner via WebSocket:", err);
      }
      
      // Refresh session to see updated workflow
      await refetchSession();
    } catch (error) {
      console.error("Failed to update workflow:", error);
      errorToast(error instanceof Error ? error.message : "Failed to update workflow");
    } finally {
      setWorkflowLoading(false);
    }
  };

  // Handler for custom workflow submission
  const handleCustomWorkflowSubmit = async () => {
    if (!customWorkflowUrl.trim()) {
      errorToast("Git URL is required");
      return;
    }
    
    setWorkflowLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectName}/agentic-sessions/${sessionName}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gitUrl: customWorkflowUrl.trim(),
          branch: customWorkflowBranch.trim() || "main",
          path: customWorkflowPath.trim() || "",
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update workflow");
      }
      
      successToast("Custom workflow activated");
      
      // Send WebSocket message to notify runner immediately
      try {
        await fetch(`/api/projects/${projectName}/agentic-sessions/${sessionName}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "workflow_change",
            gitUrl: customWorkflowUrl.trim(),
            branch: customWorkflowBranch.trim() || "main",
            path: customWorkflowPath.trim() || "",
          }),
        });
      } catch (err) {
        console.warn("Failed to notify runner via WebSocket:", err);
      }
      
      setCustomWorkflowDialogOpen(false);
      // Reset form
      setCustomWorkflowUrl("");
      setCustomWorkflowBranch("main");
      setCustomWorkflowPath("");
      // Refresh session
      await refetchSession();
    } catch (error) {
      console.error("Failed to update workflow:", error);
      errorToast(error instanceof Error ? error.message : "Failed to update workflow");
    } finally {
      setWorkflowLoading(false);
    }
  };

  // Helper to derive repo folder from URL
  const deriveRepoFolderFromUrl = useCallback((url: string): string => {
    try {
      const cleaned = url.replace(/^git@([^:]+):/, "https://$1/");
      const u = new URL(cleaned);
      const segs = u.pathname.split('/').filter(Boolean);
      const last = segs[segs.length - 1] || "repo";
      return last.replace(/\.git$/i, "");
    } catch {
      const parts = url.split('/');
      const last = parts[parts.length - 1] || "repo";
      return last.replace(/\.git$/i, "");
    }
  }, []);

  // Fetch all repo diffs using React Query hook
  useAllSessionGitHubDiffs(
    projectName,
    sessionName,
    session?.spec?.repos as Array<{ input: { url: string; branch: string }; output?: { url: string; branch: string } }> | undefined,
    deriveRepoFolderFromUrl,
    { 
      enabled: !!session?.spec?.repos,
      sessionPhase: session?.status?.phase 
    }
  );

  // Adapter: convert SessionMessage to StreamMessage
  type RawWireMessage = SessionMessage & { payload?: unknown; timestamp?: string };
  type InnerEnvelope = {
    type?: string;
    timestamp?: string;
    payload?: Record<string, unknown> | string;
    partial?: { id: string; index: number; total: number; data: string };
    seq?: number;
  };

  const streamMessages: Array<MessageObject | ToolUseMessages> = useMemo(() => {
    const toolUseBlocks: { block: ToolUseBlock; timestamp: string }[] = [];
    const toolResultBlocks: { block: ToolResultBlock; timestamp: string }[] = [];
    const agenticMessages: MessageObject[] = [];

    for (const raw of messages as RawWireMessage[]) {
      const envelope: InnerEnvelope = ((raw?.payload as InnerEnvelope) ?? (raw as unknown as InnerEnvelope)) || {};
      const innerType: string = (raw as unknown as InnerEnvelope)?.type || envelope.type || "";
      const innerTs: string = raw?.timestamp || envelope.timestamp || new Date().toISOString();
      const payloadValue = envelope.payload;
      const innerPayload: Record<string, unknown> = (payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue))
        ? (payloadValue as Record<string, unknown>)
        : ((typeof envelope === 'object' ? (envelope as unknown as Record<string, unknown>) : {}) as Record<string, unknown>);
      const partial = (envelope.partial as InnerEnvelope["partial"]) || ((raw as unknown as { partial?: InnerEnvelope["partial"] })?.partial) || undefined;

      switch (innerType) {
        case "message.partial": {
          const text = partial?.data || "";
          if (text) {
            agenticMessages.push({
              type: "agent_message",
              content: { type: "text_block", text },
              model: "claude",
              timestamp: innerTs,
            });
          }
          break;
        }
        case "agent.message": {
          if (partial?.data) {
            const text = String(partial.data || "");
            if (text) {
              agenticMessages.push({
                type: "agent_message",
                content: { type: "text_block", text },
                model: "claude",
                timestamp: innerTs,
              });
              break;
            }
          }

          const toolName = (innerPayload?.tool as string | undefined);
          const toolInput = (innerPayload?.input as Record<string, unknown> | undefined) || {};
          const providedId = (innerPayload?.id as string | undefined);
          const result = innerPayload?.tool_result as unknown as { tool_use_id?: string; content?: unknown; is_error?: boolean } | undefined;
          
          if (toolName) {
            const id = providedId ? String(providedId) : String(envelope?.seq ?? `${toolName}-${toolUseBlocks.length}`);
            toolUseBlocks.push({
              block: { type: "tool_use_block", id, name: toolName, input: toolInput },
              timestamp: innerTs,
            });
          } else if (result?.tool_use_id) {
            toolResultBlocks.push({
              block: {
                type: "tool_result_block",
                tool_use_id: String(result.tool_use_id),
                content: (result.content as string | Array<Record<string, unknown>> | null | undefined) ?? null,
                is_error: Boolean(result.is_error),
              },
              timestamp: innerTs,
            });
          } else if ((innerPayload as Record<string, unknown>)?.type === 'result.message') {
            let rp: Record<string, unknown> = (innerPayload.payload as Record<string, unknown>) || {};
            if (rp && typeof rp === 'object' && 'payload' in rp && rp.payload && typeof rp.payload === 'object') {
              rp = rp.payload as Record<string, unknown>;
            }
            agenticMessages.push({
              type: "result_message",
              subtype: String(rp.subtype || ""),
              duration_ms: Number(rp.duration_ms || 0),
              duration_api_ms: Number(rp.duration_api_ms || 0),
              is_error: Boolean(rp.is_error || false),
              num_turns: Number(rp.num_turns || 0),
              session_id: String(rp.session_id || ""),
              total_cost_usd: (typeof rp.total_cost_usd === 'number' ? rp.total_cost_usd : null),
              usage: (typeof rp.usage === 'object' && rp.usage ? rp.usage as Record<string, unknown> : null),
              result: (typeof rp.result === 'string' ? rp.result : null),
              timestamp: innerTs,
            });
            if (typeof rp.result === 'string' && rp.result.trim()) {
              agenticMessages.push({
                type: "agent_message",
                content: { type: "text_block", text: String(rp.result) },
                model: "claude",
                timestamp: innerTs,
              });
            }
          } else {
            const envelopePayload = envelope.payload;
            const contentText = (innerPayload.content as Record<string, unknown> | undefined)?.text;
            const messageText = innerPayload.message;
            const nestedContentText = (innerPayload.payload as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined;
            const text = (typeof envelopePayload === 'string')
              ? String(envelopePayload)
              : (
                  (typeof contentText === 'string' ? String(contentText) : undefined)
                  || (typeof messageText === 'string' ? String(messageText) : undefined)
                  || (typeof nestedContentText?.text === 'string' ? String(nestedContentText.text) : '')
                );
            if (text) {
              agenticMessages.push({
                type: "agent_message",
                content: { type: "text_block", text },
                model: "claude",
                timestamp: innerTs,
              });
            }
          }
          break;
        }
        case "system.message": {
          let text = "";
          let isDebug = false;
          
          // The envelope object might have message/payload at different levels
          // Try envelope.payload first, then fall back to envelope itself
          const envelopeObj = envelope as { message?: string; payload?: string | { message?: string; payload?: string; debug?: boolean }; debug?: boolean };
          
          // Check if envelope.payload is a string
          if (typeof envelopeObj.payload === 'string') {
            text = envelopeObj.payload;
          }
          // Check if envelope.payload is an object with message or payload
          else if (typeof envelopeObj.payload === 'object' && envelopeObj.payload !== null) {
            const payloadObj = envelopeObj.payload as { message?: string; payload?: string; debug?: boolean };
            text = payloadObj.message || (typeof payloadObj.payload === 'string' ? payloadObj.payload : "");
            isDebug = payloadObj.debug === true;
          }
          // Fall back to envelope.message directly
          else if (typeof envelopeObj.message === 'string') {
            text = envelopeObj.message;
          }
          
          if (envelopeObj.debug === true) {
            isDebug = true;
          }
          
          // Always create a system message - show the raw envelope if we couldn't extract text
          agenticMessages.push({
            type: "system_message",
            subtype: "system.message",
            data: { 
              message: text || `[system event: ${JSON.stringify(envelope)}]`,
              debug: isDebug 
            },
            timestamp: innerTs,
          });
          break;
        }
        case "user.message":
        case "user_message": {
          const text = (innerPayload?.content as string | undefined) || "";
          if (text) {
            agenticMessages.push({
              type: "user_message",
              content: { type: "text_block", text },
              timestamp: innerTs,
            });
          }
          break;
        }
        case "agent.running": {
          agenticMessages.push({ type: "agent_running", timestamp: innerTs });
          break;
        }
        case "agent.waiting": {
          agenticMessages.push({ type: "agent_waiting", timestamp: innerTs });
          break;
        }
        default: {
          agenticMessages.push({
            type: "system_message",
            subtype: innerType || "unknown",
            data: innerPayload || {},
            timestamp: innerTs,
          });
        }
      }
    }

    const toolUseMessages: ToolUseMessages[] = [];
    for (const tu of toolUseBlocks) {
      const match = toolResultBlocks.find((tr) => tr.block.tool_use_id === tu.block.id);
      if (match) {
        toolUseMessages.push({
          type: "tool_use_messages",
          timestamp: tu.timestamp,
          toolUseBlock: tu.block,
          resultBlock: match.block,
        });
      } else {
        toolUseMessages.push({
          type: "tool_use_messages",
          timestamp: tu.timestamp,
          toolUseBlock: tu.block,
          resultBlock: { type: "tool_result_block", tool_use_id: tu.block.id, content: null, is_error: false },
        });
      }
    }

    const all = [...agenticMessages, ...toolUseMessages];
    const sorted = all.sort((a, b) => {
      const at = new Date(a.timestamp || 0).getTime();
      const bt = new Date(b.timestamp || 0).getTime();
      return at - bt;
    });
    return session?.spec?.interactive ? sorted.filter((m) => m.type !== "result_message") : sorted;
  }, [messages, session?.spec?.interactive]);

  // Handlers
  const handleStop = () => {
    stopMutation.mutate(
      { projectName, sessionName },
      {
        onSuccess: () => successToast("Session stopped successfully"),
        onError: (err) => errorToast(err instanceof Error ? err.message : "Failed to stop session"),
      }
    );
  };

  const handleDelete = () => {
    const displayName = session?.spec.displayName || session?.metadata.name;
    if (!confirm(`Are you sure you want to delete agentic session "${displayName}"? This action cannot be undone.`)) {
      return;
    }

    deleteMutation.mutate(
      { projectName, sessionName },
      {
        onSuccess: () => {
          router.push(backHref || `/projects/${encodeURIComponent(projectName)}/sessions`);
        },
        onError: (err) => errorToast(err instanceof Error ? err.message : "Failed to delete session"),
      }
    );
  };

  const handleContinue = () => {
    continueMutation.mutate(
      { projectName, parentSessionName: sessionName },
      {
        onSuccess: () => {
          successToast("Session restarted successfully");
        },
        onError: (err) => errorToast(err instanceof Error ? err.message : "Failed to restart session"),
      }
    );
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;

    sendChatMutation.mutate(
      { projectName, sessionName, content: chatInput.trim() },
      {
        onSuccess: () => {
          setChatInput("");
        },
        onError: (err) => errorToast(err instanceof Error ? err.message : "Failed to send message"),
      }
    );
  };

  const handleInterrupt = () => {
    sendControlMutation.mutate(
      { projectName, sessionName, type: 'interrupt' },
      {
        onSuccess: () => successToast("Agent interrupted"),
        onError: (err) => errorToast(err instanceof Error ? err.message : "Failed to interrupt agent"),
      }
    );
  };

  const handleEndSession = () => {
    sendControlMutation.mutate(
      { projectName, sessionName, type: 'end_session' },
      {
        onSuccess: () => successToast("Session ended successfully"),
        onError: (err) => errorToast(err instanceof Error ? err.message : "Failed to end session"),
      }
    );
  };

  const handleSeedWorkflow = useCallback(async () => {
    if (!rfeWorkflowId) return;
    return new Promise<void>((resolve, reject) => {
      seedWorkflowMutation.mutate(
        { projectName, workflowId: rfeWorkflowId },
        {
          onSuccess: () => {
            successToast("Repository seeded successfully");
            refetchSeeding();
            resolve();
          },
          onError: (err) => {
            errorToast(err instanceof Error ? err.message : "Failed to seed repository");
            reject(err);
          },
        }
      );
    });
  }, [projectName, rfeWorkflowId, seedWorkflowMutation, refetchSeeding]);

  const handleUpdateRepositories = useCallback(async (data: { umbrellaRepo: { url: string; branch?: string }; supportingRepos: { url: string; branch?: string }[] }) => {
    if (!rfeWorkflowId) return;
    return new Promise<void>((resolve, reject) => {
      updateWorkflowMutation.mutate(
        {
          projectName,
          workflowId: rfeWorkflowId,
          data: {
            umbrellaRepo: data.umbrellaRepo,
            supportingRepos: data.supportingRepos,
          },
        },
        {
          onSuccess: () => {
            successToast("Repositories updated successfully");
            refetchWorkflow();
            refetchSeeding();
            seedWorkflowMutation.reset();
            resolve();
          },
          onError: (err) => {
            errorToast(err instanceof Error ? err.message : "Failed to update repositories");
            reject(err);
          },
        }
      );
    });
  }, [projectName, rfeWorkflowId, updateWorkflowMutation, refetchWorkflow, refetchSeeding, seedWorkflowMutation]);

  // Seeding status from React Query
  const isSeeded = seedingData?.isSeeded || false;
  const seedingError = seedWorkflowMutation.error?.message || seedingQueryError?.message;
  const hasCheckedSeeding = seedingData !== undefined || !!seedingQueryError;
  const seedingStatus = {
    checking: checkingSeeding,
    isSeeded,
    error: seedingError,
    hasChecked: hasCheckedSeeding,
  };
  const workflowWorkspace = rfeWorkflow?.workspacePath || (rfeWorkflowId ? `/rfe-workflows/${rfeWorkflowId}/workspace` : '');

  // Check if session is completed
  const sessionCompleted = (
    session?.status?.phase === 'Completed' ||
    session?.status?.phase === 'Failed' ||
    session?.status?.phase === 'Stopped'
  );

  // Auto-spawn content pod on completed session
  // Don't auto-retry if we already encountered an error - user must explicitly retry
  useEffect(() => {
    if (sessionCompleted && !contentPodReady && !contentPodSpawning && !contentPodError) {
      spawnContentPodAsync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCompleted, contentPodReady, contentPodSpawning, contentPodError]);

  const spawnContentPodAsync = async () => {
    if (!projectName || !sessionName) return;
    
    setContentPodSpawning(true);
    setContentPodError(null); // Clear any previous errors
    
    try {
      // Import API function
      const { spawnContentPod, getContentPodStatus } = await import('@/services/api/sessions');
      
      // Spawn pod
      const spawnResult = await spawnContentPod(projectName, sessionName);
      
      // If already exists and ready, we're done
      if (spawnResult.status === 'exists' && spawnResult.ready) {
        setContentPodReady(true);
        setContentPodSpawning(false);
        setContentPodError(null);
        return;
      }
      
      // Poll for readiness
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds
      
      const pollInterval = setInterval(async () => {
        attempts++;
        
        try {
          const status = await getContentPodStatus(projectName, sessionName);
          
          if (status.ready) {
            clearInterval(pollInterval);
            setContentPodReady(true);
            setContentPodSpawning(false);
            setContentPodError(null);
            successToast('Workspace viewer ready');
          }
          
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            setContentPodSpawning(false);
            const errorMsg = 'Workspace viewer failed to start within 30 seconds';
            setContentPodError(errorMsg);
            errorToast(errorMsg);
          }
        } catch {
          // Not found yet, keep polling
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            setContentPodSpawning(false);
            const errorMsg = 'Workspace viewer failed to start';
            setContentPodError(errorMsg);
            errorToast(errorMsg);
          }
        }
      }, 1000);
      
    } catch (error) {
      setContentPodSpawning(false);
      const errorMsg = error instanceof Error ? error.message : 'Failed to spawn workspace viewer';
      setContentPodError(errorMsg);
      errorToast(errorMsg);
    }
  };


  const durationMs = useMemo(() => {
    const start = session?.status?.startTime ? new Date(session.status.startTime).getTime() : undefined;
    const end = session?.status?.completionTime ? new Date(session.status.completionTime).getTime() : Date.now();
    return start ? Math.max(0, end - start) : undefined;
  }, [session?.status?.startTime, session?.status?.completionTime]);

  // Loading state - also check if params are loaded
  if (isLoading || !projectName || !sessionName) {
    return (
      <div className="min-h-screen bg-[#f8fafc]">
        <div className="container mx-auto p-6">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            <span className="ml-2">Loading session...</span>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !session) {
    return (
      <div className="min-h-screen bg-[#f8fafc]">
        <div className="sticky top-0 z-20 bg-white border-b">
          <div className="container mx-auto px-6 py-4">
            <Breadcrumbs
              items={[
                { label: 'Workspaces', href: '/projects' },
                { label: projectName, href: `/projects/${projectName}` },
                { label: 'Sessions', href: `/projects/${projectName}/sessions` },
                { label: 'Error' },
              ]}
              className="mb-4"
            />
            <PageHeader
              title="Session Error"
              description="Unable to load session"
            />
          </div>
        </div>
        <div className="container mx-auto p-0">
          <div className="px-6 pt-6">
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <p className="text-red-700">Error: {error instanceof Error ? error.message : "Session not found"}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {rfeWorkflow && (
        <EditRepositoriesDialog
          open={editRepoDialogOpen}
          onOpenChange={setEditRepoDialogOpen}
          workflow={rfeWorkflow}
          onSave={async (data) => {
            await handleUpdateRepositories(data);
            setEditRepoDialogOpen(false);
          }}
          isSaving={updateWorkflowMutation.isPending}
        />
      )}
      <div className="min-h-screen bg-[#f8fafc]">
        {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b">
        <div className="container mx-auto px-6 py-4">
          <Breadcrumbs
            items={[
              { label: 'Workspaces', href: '/projects' },
              { label: projectName, href: `/projects/${projectName}` },
              { label: 'Sessions', href: `/projects/${projectName}/sessions` },
              { label: session.spec.displayName || session.metadata.name },
            ]}
            className="mb-4"
          />
          <PageHeader
            title={session.spec.displayName || session.metadata.name}
            description={`Created ${formatDistanceToNow(new Date(session.metadata.creationTimestamp), { addSuffix: true })}`}
            actions={
              <>
                {/* Continue button for completed sessions */}
                {(session.status?.phase === "Completed" || session.status?.phase === "Failed" || session.status?.phase === "Stopped") && (
                  <Button
                    onClick={handleContinue}
                    disabled={continueMutation.isPending}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    {continueMutation.isPending ? "Starting..." : "Continue"}
                  </Button>
                )}

                {/* Stop button for active sessions */}
                {(session.status?.phase === "Pending" || session.status?.phase === "Creating" || session.status?.phase === "Running") && (
                  <Button
                    variant="secondary"
                    onClick={handleStop}
                    disabled={stopMutation.isPending}
                  >
                    <Square className="w-4 h-4 mr-2" />
                    {stopMutation.isPending ? "Stopping..." : "Stop"}
                  </Button>
                )}

                {/* Actions dropdown menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <CloneSessionDialog
                      session={session}
                      onSuccess={() => refetchSession()}
                      trigger={
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                          <Copy className="w-4 h-4 mr-2" />
                          Clone
                        </DropdownMenuItem>
                      }
                    />
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                      className="text-red-600"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {deleteMutation.isPending ? "Deleting..." : "Delete"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          />
        </div>
      </div>

      <div className="container mx-auto p-0">
        <div className="px-6 pt-6">
        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[40%_1fr] gap-6">
          {/* Left Column - Accordions */}
          <div>
            <Accordion type="multiple" value={openAccordionItems} onValueChange={setOpenAccordionItems} className="w-full space-y-3">
              <AccordionItem value="workflows" className="border rounded-lg px-3 bg-white">
                <AccordionTrigger className="text-base font-semibold hover:no-underline py-3">
                  Workflows
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Select a Workflow</label>
                      <Select value={selectedWorkflow} onValueChange={handleWorkflowChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="None selected" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None selected</SelectItem>
                          <SelectItem value="spec-kit">Spec Kit Workflow (OOTB)</SelectItem>
                          <SelectItem value="bug-fix" disabled>Bug Fix Workflow (TBD)</SelectItem>
                          <SelectItem value="custom">Custom Workflow...</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Workflows provide Ambient agents with structured steps to follow toward more complex goals.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Only show Spec Repository for plan-feature and develop-feature workflows */}
              {(selectedWorkflow === "plan-feature" || selectedWorkflow === "develop-feature") && (
              <AccordionItem value="spec-repository" className="border rounded-lg px-3 bg-white">
                <AccordionTrigger className="text-base font-semibold hover:no-underline py-3">
                  Spec Repository
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  {!rfeWorkflowId ? (
                    <div className="text-center py-6">
                      <FolderTree className="h-10 w-10 mx-auto mb-3 opacity-50 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground mb-4">
                        A spec repository is required to store agent config and workflow artifacts.
                      </p>
                      <Button onClick={() => setGithubModalOpen(true)}>
                        Add Spec Repository
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">Workspace: {workflowWorkspace}</div>

                      {rfeWorkflow?.branchName && (
                        <Alert className="border-blue-200 bg-blue-50">
                          <GitBranch className="h-4 w-4 text-blue-600" />
                          <AlertTitle className="text-blue-900">Feature Branch</AlertTitle>
                          <AlertDescription className="text-blue-800">
                            All modifications will occur on feature branch{' '}
                            <code className="px-2 py-1 bg-blue-100 text-blue-900 rounded font-semibold">
                              {rfeWorkflow.branchName}
                            </code>
                            {' '}for all supplied repositories.
                          </AlertDescription>
                        </Alert>
                      )}

                      {(rfeWorkflow?.umbrellaRepo || (rfeWorkflow?.supportingRepos || []).length > 0) && rfeWorkflow && (
                        <div className="space-y-1">
                          {rfeWorkflow.umbrellaRepo && (
                            <div className="text-sm space-y-1">
                              <div>
                                <span className="font-medium">Spec Repo:</span> {rfeWorkflow.umbrellaRepo.url}
                              </div>
                              {rfeWorkflow.umbrellaRepo.branch && (
                                <div className="ml-4 text-muted-foreground">
                                  Base branch: <code className="text-xs bg-muted px-1 py-0.5 rounded">{rfeWorkflow.umbrellaRepo.branch}</code>
                                  {rfeWorkflow.branchName && (
                                    <span> → Feature branch <code className="text-xs bg-blue-50 text-blue-700 px-1 py-0.5 rounded">{rfeWorkflow.branchName}</code> {isSeeded ? 'set up' : 'will be set up'}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {(rfeWorkflow.supportingRepos || []).map(
                            (r: { url: string; branch?: string }, i: number) => (
                              <div key={i} className="text-sm space-y-1">
                                <div>
                                  <span className="font-medium">Supporting:</span> {r.url}
                                </div>
                                {r.branch && (
                                  <div className="ml-4 text-muted-foreground">
                                    Base branch: <code className="text-xs bg-muted px-1 py-0.5 rounded">{r.branch}</code>
                                    {rfeWorkflow.branchName && (
                                      <span> → Feature branch <code className="text-xs bg-blue-50 text-blue-700 px-1 py-0.5 rounded">{rfeWorkflow.branchName}</code> {isSeeded ? 'set up' : 'will be set up'}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {!isSeeded && !seedingStatus.checking && seedingStatus.hasChecked && rfeWorkflow?.umbrellaRepo && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Spec Repository Not Seeded</AlertTitle>
                          <AlertDescription className="mt-2">
                            <p className="mb-3">
                              Before you can start working on phases, the spec repository needs to be seeded.
                              This will:
                            </p>
                            <ul className="list-disc list-inside space-y-1 mb-3 text-sm">
                              <li>Set up the feature branch{rfeWorkflow.branchName && ` (${rfeWorkflow.branchName})`} from the base branch</li>
                              <li>Add Spec-Kit template files for spec-driven development</li>
                              <li>Add agent definition files in the .claude directory</li>
                            </ul>
                            {seedingError && (
                              <div className="mb-3 p-2 bg-red-100 border border-red-300 rounded text-sm text-red-800">
                                <strong>Seeding Failed:</strong> {seedingError}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <Button
                                onClick={() => setEditRepoDialogOpen(true)}
                                disabled={updateWorkflowMutation.isPending}
                                size="sm"
                                variant="outline"
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                Edit Repositories
                              </Button>
                              <Button onClick={handleSeedWorkflow} disabled={seedWorkflowMutation.isPending || updateWorkflowMutation.isPending} size="sm">
                                {seedWorkflowMutation.isPending ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Seeding Repository...
                                  </>
                                ) : (
                                  <>
                                    <Sprout className="mr-2 h-4 w-4" />
                                    {seedingError ? "Retry Seeding" : "Seed Repository"}
                                  </>
                                )}
                              </Button>
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}

                      {seedingStatus.checking && rfeWorkflow?.umbrellaRepo && (
                        <div className="flex items-center gap-2 text-gray-600 bg-gray-50 p-3 rounded-lg">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="text-sm">Checking repository seeding status...</span>
                        </div>
                      )}

                      {isSeeded && (
                        <div className="flex items-center justify-between text-green-700 bg-green-50 p-3 rounded-lg">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                            <span className="text-sm font-medium">Repository seeded and ready</span>
                          </div>
                          <Button
                            onClick={() => setEditRepoDialogOpen(true)}
                            disabled={updateWorkflowMutation.isPending}
                            size="sm"
                            variant="outline"
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Repositories
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Spec Repository Files - Only show after spec repository is seeded */}
                  {rfeWorkflowId && isSeeded && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="border rounded-md overflow-hidden">
                        <div className="p-3 border-b flex items-center justify-between bg-gray-50">
                          <div className="flex items-center gap-2">
                            <FolderTree className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">Files</span>
                            {!artifactsLoading && (
                              <span className="text-xs text-muted-foreground">
                                ({workflowArtifacts.length} {workflowArtifacts.length === 1 ? 'file' : 'files'})
                              </span>
                            )}
                          </div>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={handleRefreshArtifacts} 
                            disabled={artifactsLoading}
                            className="h-8"
                          >
                            <RefreshCw className={`h-4 w-4 ${artifactsLoading ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>
                        <div className="p-3">
                          {artifactsLoading ? (
                            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                              <Loader2 className="animate-spin h-4 w-4 mr-2" /> Loading files...
                            </div>
                          ) : workflowArtifacts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-center text-sm text-muted-foreground">
                              <FolderTree className="h-10 w-10 mb-2 opacity-50" />
                              <p className="font-medium">No files yet</p>
                              <p className="text-xs mt-1">Files will appear here as agents create artifacts</p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {workflowArtifacts.map((artifact) => {
                                const isDirectory = artifact.type === 'tree';
                                const Icon = isDirectory ? Folder : FileText;
                                const iconColor = isDirectory ? 'text-yellow-600' : 'text-blue-500';
                                
                                return (
                                  <div
                                    key={artifact.path}
                                    className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 text-sm"
                                  >
                                    <Icon className={`h-4 w-4 ${iconColor} flex-shrink-0`} />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium truncate">{artifact.name}</div>
                                      {artifact.path !== artifact.name && (
                                        <div className="text-xs text-muted-foreground truncate">{artifact.path}</div>
                                      )}
                                    </div>
                                    {!isDirectory && artifact.size > 0 && (
                                      <div className="text-xs text-muted-foreground flex-shrink-0">
                                        {(artifact.size / 1024).toFixed(1)} KB
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
              )}

              <AccordionItem value="agents" className="border rounded-lg px-3 bg-white">
                <AccordionTrigger className="text-base font-semibold hover:no-underline py-3">
                  Agents
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  {loadingAgents ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : !rfeWorkflowId || repoAgents.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <Bot className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No agents found in repository .claude/agents directory</p>
                      <p className="text-xs mt-1">Seed the repository to add agent definitions</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-2">
                        {repoAgents.map((agent) => {
                          const isSelected = selectedAgents.includes(agent.persona);
                          return (
                            <div
                              key={agent.persona}
                              className={`p-2 rounded border transition-colors ${
                                isSelected ? 'bg-primary/5 border-primary' : 'bg-background border-border hover:border-primary/50'
                              }`}
                            >
                              <label className="flex items-start gap-2 cursor-pointer">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    setSelectedAgents(
                                      checked
                                        ? [...selectedAgents, agent.persona]
                                        : selectedAgents.filter(p => p !== agent.persona)
                                    );
                                  }}
                                  className="mt-0.5"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm">{agent.name}</div>
                                  <div className="text-xs text-muted-foreground">{agent.role}</div>
                                </div>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                      {selectedAgents.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <div className="text-sm font-medium mb-1.5">Selected Agents ({selectedAgents.length})</div>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedAgents.map(persona => {
                              const agent = repoAgents.find(a => a.persona === persona);
                              return agent ? (
                                <Badge key={persona} variant="secondary" className="text-xs">
                                  {agent.name}
                                </Badge>
                              ) : null;
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="context" className="border rounded-lg px-3 bg-white">
                <AccordionTrigger className="text-base font-semibold hover:no-underline py-3">
                  Context
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  {!rfeWorkflowId || !rfeWorkflow?.supportingRepos || rfeWorkflow.supportingRepos.length === 0 ? (
                    <div className="text-center py-6">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-3">
                        <FolderTree className="h-8 w-8 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-900 mb-1">No associated repositories configured</p>
                      <p className="text-xs text-muted-foreground mb-4">Add context from external sources</p>
                      <Button onClick={() => setContextModalOpen(true)} disabled={!rfeWorkflowId}>
                        Add Repository
                      </Button>
                      {!rfeWorkflowId && (
                        <p className="text-xs text-muted-foreground mt-2">Configure a spec repository first</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {rfeWorkflow.supportingRepos.map((repo, index) => (
                          <div key={index} className="flex items-start gap-2 p-2 rounded border bg-gray-50 hover:bg-gray-100 transition-colors">
                            <GitBranch className="h-4 w-4 text-gray-600 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{repo.url}</div>
                              {repo.branch && (
                                <div className="text-xs text-muted-foreground">
                                  Branch: <code className="text-xs bg-white px-1 py-0.5 rounded">{repo.branch}</code>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <Button onClick={() => setContextModalOpen(true)} variant="outline" className="w-full" size="sm">
                        Add Another Repository
                      </Button>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="artifacts" className="border rounded-lg px-3 bg-white">
                <AccordionTrigger className="text-base font-semibold hover:no-underline py-3">
                  Artifacts
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  <ResultsTab result={null} meta={null} />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="session-details" className="border rounded-lg px-3 bg-white">
                <AccordionTrigger className="text-base font-semibold hover:no-underline py-3">
                  Session Details
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-3">
                  <div className="space-y-3 text-sm">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700">Status:</span>
                        <span className={`text-gray-900 font-semibold ${getPhaseColor(session.status?.phase || "Pending")}`}>
                          {session.status?.phase || "Pending"}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700">Model:</span>
                        <span className="text-gray-900">{session.spec.llmSettings.model}</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700">Temperature:</span>
                        <span className="text-gray-900">{session.spec.llmSettings.temperature}</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700">Mode:</span>
                        <span className="text-gray-900">{session.spec?.interactive ? "Interactive" : "Headless"}</span>
                      </div>
                      {session.status?.startTime && (
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-gray-700">Started:</span>
                          <span className="text-gray-900">{format(new Date(session.status.startTime), "PPp")}</span>
                        </div>
                      )}
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700">Duration:</span>
                        <span className="text-gray-900">{typeof durationMs === "number" ? `${durationMs}ms` : "-"}</span>
                      </div>
                      {k8sResources?.pvcName && (
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-gray-700">PVC:</span>
                          <span className="text-gray-900 font-mono text-xs">{k8sResources.pvcName}</span>
                        </div>
                      )}
                      {k8sResources?.pvcSize && (
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-gray-700">PVC Size:</span>
                          <span className="text-gray-900">{k8sResources.pvcSize}</span>
                        </div>
                      )}
                      {session.status?.jobName && (
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-gray-700">K8s Job:</span>
                          <span className="text-gray-900 font-mono text-xs">{session.status.jobName}</span>
                        </div>
                      )}
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700">Messages:</span>
                        <span className="text-gray-900">{messages.length}</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700">Session prompt:</span>
                        <button
                          onClick={() => setPromptExpanded(!promptExpanded)}
                          className="text-blue-600 hover:underline"
                        >
                          {promptExpanded ? "hide" : "view"}
                        </button>
                      </div>
                      {promptExpanded && session.spec.prompt && (
                        <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200">
                          <p className="whitespace-pre-wrap text-sm text-gray-800">{session.spec.prompt}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          {/* Right Column - Messages (Always Visible) */}
          <div>
            <Card>
              <CardContent className="p-3">
                <MessagesTab
                  session={session}
                  streamMessages={streamMessages}
                  chatInput={chatInput}
                  setChatInput={setChatInput}
                  onSendChat={() => Promise.resolve(sendChat())}
                  onInterrupt={() => Promise.resolve(handleInterrupt())}
                  onEndSession={() => Promise.resolve(handleEndSession())}
                  onGoToResults={() => {}}
                  onContinue={handleContinue}
                />
              </CardContent>
            </Card>
          </div>
        </div>
        </div>
      </div>
    </div>

    {/* Add Spec Repository Modal */}
    <Dialog open={githubModalOpen} onOpenChange={setGithubModalOpen}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Add spec repository</DialogTitle>
          <DialogDescription>
            Set the spec repo and optional supporting repos. Base branch is the branch from which the feature branch will be set up. All modifications will be made to the feature branch.
          </DialogDescription>
        </DialogHeader>
        
        {!githubStatus?.installed && !secretsValues?.some(secret => secret.key === 'GIT_TOKEN' && secret.value) && (
          <div className="mb-4">
            <GitHubConnectionCard appSlug="ambient-code-vteam" showManageButton={false} />
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="spec-repo-url">Spec Repo URL</Label>
            <Input
              id="spec-repo-url"
              placeholder="https://github.com/org/repo.git"
              value={specRepoUrl}
              onChange={(e) => setSpecRepoUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The spec repository contains your feature specifications, planning documents, and agent configurations for this RFE workspace
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="base-branch">Base Branch</Label>
            <Input
              id="base-branch"
              placeholder="main"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Supporting Repositories (optional)</Label>
            <Button variant="outline" className="w-full">
              Add supporting repo
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setGithubModalOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={async () => {
              if (!specRepoUrl.trim() || !projectName || !sessionName) return;
              
              // Generate a unique branch name based on session name
              const timestamp = Date.now();
              const branchName = `feature/${sessionName}-${timestamp}`;
              
              try {
                // Create the workflow
                const result = await createWorkflowMutation.mutateAsync({
                  projectName,
                  data: {
                    title: `Workflow for ${sessionName}`,
                    description: `Auto-generated workflow for session ${sessionName}`,
                    branchName,
                    umbrellaRepo: {
                      url: specRepoUrl.trim(),
                      branch: baseBranch.trim() || 'main',
                    },
                    supportingRepos: [],
                  },
                });
                
                // Link the session to the workflow
                const { linkSessionToWorkflow } = await import('@/services/api/rfe');
                await linkSessionToWorkflow(projectName, result.id, sessionName);
                
                successToast('Spec repository configured successfully');
                setGithubModalOpen(false);
                
                // Refresh the session to get the updated workflow ID
                await refetchSession();
                await refetchWorkflow();
              } catch (err) {
                errorToast(err instanceof Error ? err.message : 'Failed to configure repository');
              }
            }}
            disabled={!specRepoUrl.trim() || createWorkflowMutation.isPending}
          >
            {createWorkflowMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Configuration'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Add Context Modal */}
    <Dialog open={contextModalOpen} onOpenChange={setContextModalOpen}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Context</DialogTitle>
          <DialogDescription>
            Add external context sources to enhance agent understanding
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="context-url">Repository URL</Label>
            <Input
              id="context-url"
              placeholder="https://github.com/org/repo"
              value={contextUrl}
              onChange={(e) => setContextUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Currently supports GitHub repositories for code context
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="context-branch">Branch (optional)</Label>
            <Input
              id="context-branch"
              placeholder="main"
              value={contextBranch}
              onChange={(e) => setContextBranch(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use the default branch
            </p>
          </div>

          <Alert className="border-blue-200 bg-blue-50">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-sm">
              Google Drive and Jira support coming soon
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setContextUrl("");
              setContextBranch("main");
              setContextModalOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={async () => {
              if (!contextUrl.trim() || !rfeWorkflowId) return;
              
              try {
                // Get existing supporting repos
                const existingSupportingRepos = rfeWorkflow?.supportingRepos || [];
                
                // Add new repository
                const newRepo = {
                  url: contextUrl.trim(),
                  ...(contextBranch.trim() && { branch: contextBranch.trim() })
                };
                
                // Update workflow with new supporting repos
                await updateWorkflowMutation.mutateAsync({
                  projectName,
                  workflowId: rfeWorkflowId,
                  data: {
                    supportingRepos: [...existingSupportingRepos, newRepo],
                  },
                });
                
                successToast('Context repository added successfully');
                setContextUrl("");
                setContextBranch("main");
                setContextModalOpen(false);
                
                // Refresh workflow data
                await refetchWorkflow();
              } catch (err) {
                errorToast(err instanceof Error ? err.message : 'Failed to add context repository');
              }
            }}
            disabled={!contextUrl.trim() || !rfeWorkflowId || updateWorkflowMutation.isPending}
          >
            {updateWorkflowMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              'Add'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Custom Workflow Dialog */}
    <Dialog open={customWorkflowDialogOpen} onOpenChange={setCustomWorkflowDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load Custom Workflow</DialogTitle>
          <DialogDescription>
            Enter the Git repository URL and optional path for your custom workflow.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workflow-url">Git Repository URL *</Label>
            <Input
              id="workflow-url"
              placeholder="https://github.com/org/workflow-repo.git"
              value={customWorkflowUrl}
              onChange={(e) => setCustomWorkflowUrl(e.target.value)}
              disabled={workflowLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="workflow-branch">Branch</Label>
            <Input
              id="workflow-branch"
              placeholder="main"
              value={customWorkflowBranch}
              onChange={(e) => setCustomWorkflowBranch(e.target.value)}
              disabled={workflowLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="workflow-path">Path (optional)</Label>
            <Input
              id="workflow-path"
              placeholder="workflows/my-workflow"
              value={customWorkflowPath}
              onChange={(e) => setCustomWorkflowPath(e.target.value)}
              disabled={workflowLoading}
            />
            <p className="text-xs text-muted-foreground">
              Optional subdirectory within the repository containing the workflow
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setCustomWorkflowDialogOpen(false)}
            disabled={workflowLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCustomWorkflowSubmit}
            disabled={!customWorkflowUrl.trim() || workflowLoading}
          >
            {workflowLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              'Load Workflow'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

