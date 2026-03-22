/**
 * Scraping V3 React Hooks — TanStack Query integration for the orchestrator.
 *
 * Follows the queryKey factory pattern from useOrchestrator.ts.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { IpcClient } from "../ipc/ipc_client";

const client = IpcClient.getInstance();

// ============================================================================
// Query Keys
// ============================================================================

export const scrapingKeys = {
  all: ["scraping"] as const,

  // Jobs
  jobs: () => [...scrapingKeys.all, "jobs"] as const,
  jobList: (status?: string) =>
    [...scrapingKeys.jobs(), "list", status] as const,
  jobDetail: (id: string) =>
    [...scrapingKeys.jobs(), "detail", id] as const,

  // Results
  results: () => [...scrapingKeys.all, "results"] as const,
  jobResults: (jobId: string) =>
    [...scrapingKeys.results(), "job", jobId] as const,

  // Schedules
  schedules: () => [...scrapingKeys.all, "schedules"] as const,
  scheduleList: () =>
    [...scrapingKeys.schedules(), "list"] as const,

  // Templates
  templates: () => [...scrapingKeys.all, "templates"] as const,
  templateList: () =>
    [...scrapingKeys.templates(), "list"] as const,
  templateDetail: (id: string) =>
    [...scrapingKeys.templates(), "detail", id] as const,

  // Sessions
  sessions: () => [...scrapingKeys.all, "sessions"] as const,
  sessionList: () =>
    [...scrapingKeys.sessions(), "list"] as const,

  // Probe
  probe: (url: string) =>
    [...scrapingKeys.all, "probe", url] as const,
};

// ============================================================================
// Job Hooks
// ============================================================================

/** List all scraping jobs, optionally filtered by status. */
export function useScrapingJobs(status?: string) {
  return useQuery({
    queryKey: scrapingKeys.jobList(status),
    queryFn: () => client.scrapingV3ListJobs(status ? { status } : undefined),
  });
}

/** Get a single scraping job by ID. */
export function useScrapingJob(jobId: string | undefined) {
  return useQuery({
    queryKey: scrapingKeys.jobDetail(jobId ?? ""),
    queryFn: () => client.scrapingV3GetJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Auto-refresh while running
      if (data?.status === "running") return 2000;
      return false;
    },
  });
}

/** Create a new scraping job. */
export function useCreateScrapingJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      name: string;
      config: any;
      engine?: string;
      templateId?: string;
      datasetId?: string;
    }) => client.scrapingV3CreateJob(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.jobs() });
    },
  });
}

/** Run a job (starts background execution). */
export function useRunScrapingJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingV3RunJob(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.jobs() });
    },
  });
}

/** Pause a running job. */
export function usePauseScrapingJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingV3PauseJob(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.jobs() });
    },
  });
}

/** Cancel a job. */
export function useCancelScrapingJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingV3CancelJob(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.jobs() });
    },
  });
}

/** Resume a paused job. */
export function useResumeScrapingJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingV3ResumeJob(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.jobs() });
    },
  });
}

/** Delete a job and its results. */
export function useDeleteScrapingJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingV3DeleteJob(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.jobs() });
    },
  });
}

// ============================================================================
// Quick Scrape
// ============================================================================

/** Quick scrape a single URL (mutation, not cached). */
export function useQuickScrape() {
  return useMutation({
    mutationFn: (args: { url: string; engine?: string }) =>
      client.scrapingV3QuickScrape(args),
  });
}

/** Probe a URL to determine best engine. */
export function useProbeUrl(url: string | undefined) {
  return useQuery({
    queryKey: scrapingKeys.probe(url ?? ""),
    queryFn: () => client.scrapingV3ProbeUrl(url!),
    enabled: !!url && url.length > 0,
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

// ============================================================================
// Results
// ============================================================================

/** Get extraction results for a job. */
export function useScrapingResults(jobId: string | undefined) {
  return useQuery({
    queryKey: scrapingKeys.jobResults(jobId ?? ""),
    queryFn: () => client.scrapingV3GetResults(jobId!),
    enabled: !!jobId,
  });
}

/** Export job results. */
export function useExportResults() {
  return useMutation({
    mutationFn: (args: { jobId: string; format: string; stripPii?: boolean }) =>
      client.scrapingV3Export(args),
  });
}

/** Detect PII in results. */
export function useDetectPII() {
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingV3DetectPii(jobId),
  });
}

// ============================================================================
// Schedules
// ============================================================================

/** List all schedules. */
export function useScrapingSchedules() {
  return useQuery({
    queryKey: scrapingKeys.scheduleList(),
    queryFn: () => client.scrapingV3ListSchedules(),
  });
}

/** Create a schedule. */
export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      name: string;
      jobConfig: any;
      cronExpression: string;
    }) => client.scrapingV3CreateSchedule(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.schedules() });
    },
  });
}

/** Toggle a schedule on/off. */
export function useToggleSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) =>
      client.scrapingV3ToggleSchedule(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.schedules() });
    },
  });
}

/** Delete a schedule. */
export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.scrapingV3DeleteSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.schedules() });
    },
  });
}

// ============================================================================
// Templates
// ============================================================================

/** List user templates. */
export function useScrapingTemplates() {
  return useQuery({
    queryKey: scrapingKeys.templateList(),
    queryFn: () => client.scrapingV3ListTemplates(),
  });
}

/** Get a template by ID. */
export function useScrapingTemplate(id: string | undefined) {
  return useQuery({
    queryKey: scrapingKeys.templateDetail(id ?? ""),
    queryFn: () => client.scrapingV3GetTemplate(id!),
    enabled: !!id,
  });
}

/** Create a user template. */
export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      name: string;
      description: string;
      category: string;
      config: any;
    }) => client.scrapingV3CreateTemplate(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.templates() });
    },
  });
}

/** Delete a user template. */
export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.scrapingV3DeleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.templates() });
    },
  });
}

// ============================================================================
// Auth Sessions
// ============================================================================

/** List saved auth sessions. */
export function useScrapingSessions() {
  return useQuery({
    queryKey: scrapingKeys.sessionList(),
    queryFn: () => client.scrapingV3ListSessions(),
  });
}

/** Delete an auth session. */
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.scrapingV3DeleteSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.sessions() });
    },
  });
}

/** Import cookies as a session. */
export function useImportCookies() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      name: string;
      domain: string;
      cookieFileContent: string;
    }) => client.scrapingV3ImportCookies(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scrapingKeys.sessions() });
    },
  });
}

// ============================================================================
// Job Progress Listener
// ============================================================================

/**
 * Subscribe to real-time job progress events from the main process.
 */
export function useScrapingJobProgress(
  onProgress: (job: any) => void,
) {
  useEffect(() => {
    const electron = (window as any).electron;
    if (!electron?.ipcRenderer) return;

    const handler = (_event: any, job: any) => {
      onProgress(job);
    };

    electron.ipcRenderer.on("scraping:v3:job-progress", handler);
    return () => {
      electron.ipcRenderer.removeListener("scraping:v3:job-progress", handler);
    };
  }, [onProgress]);
}
