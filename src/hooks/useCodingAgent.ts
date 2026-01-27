/**
 * React hooks for the AI Coding Agent
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  codingAgentClient,
  type AgentSession,
  type AgentSessionId,
  type AgentTask,
  type AgentConfig,
  type TaskType,
  type TaskContext,
  type AgentCapability,
  type ApprovalRequest,
  type AgentEvent,
} from "../ipc/coding_agent_client.js";

// Query keys
const AGENT_KEYS = {
  all: ["coding-agent"] as const,
  sessions: () => [...AGENT_KEYS.all, "sessions"] as const,
  session: (id: AgentSessionId) => [...AGENT_KEYS.sessions(), id] as const,
  approvals: (sessionId?: AgentSessionId) => [...AGENT_KEYS.all, "approvals", sessionId] as const,
  capabilities: () => [...AGENT_KEYS.all, "capabilities"] as const,
};

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------

export function useCodingAgentSessions() {
  return useQuery({
    queryKey: AGENT_KEYS.sessions(),
    queryFn: () => codingAgentClient.listSessions(),
    refetchInterval: 5000,
  });
}

export function useCodingAgentSession(sessionId: AgentSessionId | null) {
  return useQuery({
    queryKey: AGENT_KEYS.session(sessionId!),
    queryFn: () => codingAgentClient.getSession(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 1000,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: Partial<AgentConfig>) => codingAgentClient.createSession(config),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: AGENT_KEYS.sessions() });
      toast.success("Agent session created");
    },
    onError: (error) => {
      toast.error(`Failed to create session: ${error}`);
    },
  });
}

export function useEndSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: AgentSessionId) => codingAgentClient.endSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENT_KEYS.sessions() });
      toast.success("Agent session ended");
    },
    onError: (error) => {
      toast.error(`Failed to end session: ${error}`);
    },
  });
}

// ---------------------------------------------------------------------------
// TASKS
// ---------------------------------------------------------------------------

export function useRunTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId,
      type,
      description,
      context,
    }: {
      sessionId: AgentSessionId;
      type: TaskType;
      description: string;
      context?: Partial<TaskContext>;
    }) => codingAgentClient.runTask(sessionId, type, description, context),
    onSuccess: (task, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: AGENT_KEYS.session(sessionId) });
    },
    onError: (error) => {
      toast.error(`Task failed: ${error}`);
    },
  });
}

// ---------------------------------------------------------------------------
// APPROVALS
// ---------------------------------------------------------------------------

export function usePendingApprovals(sessionId?: AgentSessionId) {
  return useQuery({
    queryKey: AGENT_KEYS.approvals(sessionId),
    queryFn: () => codingAgentClient.getPendingApprovals(sessionId),
    refetchInterval: 1000,
  });
}

export function useApproveAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId, approved }: { requestId: string; approved: boolean }) =>
      codingAgentClient.approveAction(requestId, approved),
    onSuccess: (_, { approved }) => {
      queryClient.invalidateQueries({ queryKey: AGENT_KEYS.approvals() });
      toast.success(approved ? "Action approved" : "Action rejected");
    },
    onError: (error) => {
      toast.error(`Failed to process approval: ${error}`);
    },
  });
}

// ---------------------------------------------------------------------------
// CAPABILITIES
// ---------------------------------------------------------------------------

export function useAgentCapabilities() {
  return useQuery({
    queryKey: AGENT_KEYS.capabilities(),
    queryFn: () => codingAgentClient.getCapabilities(),
    staleTime: Infinity,
  });
}

// ---------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------

export function useAgentEvents(sessionId?: AgentSessionId) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<AgentEvent | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const handleEvent = (event: AgentEvent) => {
      setLatestEvent(event);
      setEvents((prev) => [...prev.slice(-99), event]); // Keep last 100 events
    };

    const subscribe = async () => {
      if (sessionId) {
        unsubscribeRef.current = await codingAgentClient.subscribeToSession(sessionId, handleEvent);
      } else {
        unsubscribeRef.current = await codingAgentClient.subscribe(handleEvent);
      }
    };

    subscribe();

    return () => {
      unsubscribeRef.current?.();
    };
  }, [sessionId]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  return { events, latestEvent, clearEvents };
}

// ---------------------------------------------------------------------------
// COMBINED HOOK FOR FULL AGENT EXPERIENCE
// ---------------------------------------------------------------------------

export interface UseCodingAgentOptions {
  workingDirectory?: string;
  autoApprove?: boolean;
  safeMode?: boolean;
  modelId?: string;
}

export function useCodingAgent(options: UseCodingAgentOptions = {}) {
  const [sessionId, setSessionId] = useState<AgentSessionId | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTask, setCurrentTask] = useState<AgentTask | null>(null);
  const [output, setOutput] = useState<string[]>([]);

  const createSession = useCreateSession();
  const endSession = useEndSession();
  const runTask = useRunTask();
  const { data: session } = useCodingAgentSession(sessionId);
  const { data: approvals } = usePendingApprovals(sessionId ?? undefined);
  const approveAction = useApproveAction();
  const { events, latestEvent, clearEvents } = useAgentEvents(sessionId ?? undefined);

  // Handle events
  useEffect(() => {
    if (!latestEvent) return;

    switch (latestEvent.type) {
      case "task:started":
        setIsRunning(true);
        setOutput((prev) => [...prev, `🚀 Task started: ${latestEvent.data?.task?.description || ""}`]);
        break;
      case "task:completed":
        setIsRunning(false);
        setCurrentTask(null);
        setOutput((prev) => [...prev, `✅ Task completed`]);
        break;
      case "task:failed":
        setIsRunning(false);
        setOutput((prev) => [...prev, `❌ Task failed: ${latestEvent.data?.error || "Unknown error"}`]);
        break;
      case "step:started":
        setOutput((prev) => [...prev, `▶️ ${latestEvent.data?.step?.description || "Step started"}`]);
        break;
      case "step:completed":
        setOutput((prev) => [...prev, `  ✓ Step completed`]);
        break;
      case "step:failed":
        setOutput((prev) => [...prev, `  ✗ Step failed: ${latestEvent.data?.result?.error || ""}`]);
        break;
      case "thinking":
        setOutput((prev) => [...prev, `🤔 ${latestEvent.data?.message || "Thinking..."}`]);
        break;
      case "output":
        if (latestEvent.data?.data) {
          setOutput((prev) => [...prev, `  ${latestEvent.data.data}`]);
        }
        break;
      case "approval:requested":
        toast.info("Action requires approval", {
          action: {
            label: "Review",
            onClick: () => {},
          },
        });
        break;
    }
  }, [latestEvent]);

  // Start a new session
  const start = useCallback(
    async (config?: Partial<AgentConfig>) => {
      const newSession = await createSession.mutateAsync({
        workingDirectory: options.workingDirectory || process.cwd(),
        autoApprove: options.autoApprove ?? false,
        safeMode: options.safeMode ?? true,
        modelId: options.modelId,
        ...config,
      });
      setSessionId(newSession.id);
      setOutput([`Agent session started`]);
      return newSession;
    },
    [createSession, options]
  );

  // Stop the current session
  const stop = useCallback(async () => {
    if (sessionId) {
      await endSession.mutateAsync(sessionId);
      setSessionId(null);
      setCurrentTask(null);
      setIsRunning(false);
      setOutput((prev) => [...prev, `Agent session ended`]);
    }
  }, [sessionId, endSession]);

  // Run a task
  const run = useCallback(
    async (type: TaskType, description: string, context?: Partial<TaskContext>) => {
      if (!sessionId) {
        const newSession = await start();
        const task = await runTask.mutateAsync({
          sessionId: newSession.id,
          type,
          description,
          context,
        });
        setCurrentTask(task);
        return task;
      }

      const task = await runTask.mutateAsync({
        sessionId,
        type,
        description,
        context,
      });
      setCurrentTask(task);
      return task;
    },
    [sessionId, start, runTask]
  );

  // Approve/reject an action
  const approve = useCallback(
    async (requestId: string, approved: boolean) => {
      await approveAction.mutateAsync({ requestId, approved });
    },
    [approveAction]
  );

  // Clear output
  const clearOutput = useCallback(() => {
    setOutput([]);
    clearEvents();
  }, [clearEvents]);

  return {
    // State
    sessionId,
    session,
    isRunning,
    currentTask,
    output,
    events,
    approvals: approvals || [],

    // Actions
    start,
    stop,
    run,
    approve,
    clearOutput,

    // Loading states
    isStarting: createSession.isPending,
    isStopping: endSession.isPending,
    isTaskRunning: runTask.isPending || isRunning,
  };
}

// ---------------------------------------------------------------------------
// QUICK TASK HOOKS
// ---------------------------------------------------------------------------

export function useCodeTask() {
  const agent = useCodingAgent();

  const generateCode = useCallback(
    async (description: string, files?: string[]) => {
      return agent.run("code", description, { files: files?.map((f) => ({ path: f, language: "", relevance: 1 })) });
    },
    [agent]
  );

  return { ...agent, generateCode };
}

export function useDebugTask() {
  const agent = useCodingAgent();

  const debug = useCallback(
    async (errorDescription: string, errorLogs?: string[]) => {
      return agent.run("debug", errorDescription, { errorLogs });
    },
    [agent]
  );

  return { ...agent, debug };
}

export function useRefactorTask() {
  const agent = useCodingAgent();

  const refactor = useCallback(
    async (description: string, files?: string[]) => {
      return agent.run("refactor", description, { files: files?.map((f) => ({ path: f, language: "", relevance: 1 })) });
    },
    [agent]
  );

  return { ...agent, refactor };
}

export function useTestTask() {
  const agent = useCodingAgent();

  const writeTests = useCallback(
    async (description: string, files?: string[]) => {
      return agent.run("test", description, { files: files?.map((f) => ({ path: f, language: "", relevance: 1 })) });
    },
    [agent]
  );

  return { ...agent, writeTests };
}

export function useDocumentTask() {
  const agent = useCodingAgent();

  const document = useCallback(
    async (description: string, files?: string[]) => {
      return agent.run("document", description, { files: files?.map((f) => ({ path: f, language: "", relevance: 1 })) });
    },
    [agent]
  );

  return { ...agent, document };
}

export function useCodeReviewTask() {
  const agent = useCodingAgent();

  const review = useCallback(
    async (description: string, files?: string[]) => {
      return agent.run("review", description, { files: files?.map((f) => ({ path: f, language: "", relevance: 1 })) });
    },
    [agent]
  );

  return { ...agent, review };
}
