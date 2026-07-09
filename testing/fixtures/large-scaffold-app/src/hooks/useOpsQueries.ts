import { useQuery } from "@tanstack/react-query";
import {
  getAutomations,
  getCustomer,
  getCustomers,
  getDeployments,
  getIncident,
  getIncidents,
  getKnowledgeArticles,
  getProject,
  getProjects,
  getReportMetrics,
  getSettings,
  getWorkspaceOverview,
} from "@/services/mockApi";

export const queryKeys = {
  overview: ["overview"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  customers: ["customers"] as const,
  customer: (id: string) => ["customers", id] as const,
  incidents: ["incidents"] as const,
  incident: (id: string) => ["incidents", id] as const,
  deployments: ["deployments"] as const,
  automations: ["automations"] as const,
  knowledge: ["knowledge"] as const,
  reports: ["reports"] as const,
  settings: ["settings"] as const,
};

export function useWorkspaceOverview() {
  return useQuery({ queryKey: queryKeys.overview, queryFn: getWorkspaceOverview });
}

export function useProjects() {
  return useQuery({ queryKey: queryKeys.projects, queryFn: getProjects });
}

export function useProject(id: string) {
  return useQuery({ queryKey: queryKeys.project(id), queryFn: () => getProject(id) });
}

export function useCustomers() {
  return useQuery({ queryKey: queryKeys.customers, queryFn: getCustomers });
}

export function useCustomer(id: string) {
  return useQuery({ queryKey: queryKeys.customer(id), queryFn: () => getCustomer(id) });
}

export function useIncidents() {
  return useQuery({ queryKey: queryKeys.incidents, queryFn: getIncidents });
}

export function useIncident(id: string) {
  return useQuery({ queryKey: queryKeys.incident(id), queryFn: () => getIncident(id) });
}

export function useDeployments() {
  return useQuery({ queryKey: queryKeys.deployments, queryFn: getDeployments });
}

export function useAutomations() {
  return useQuery({ queryKey: queryKeys.automations, queryFn: getAutomations });
}

export function useKnowledgeArticles() {
  return useQuery({ queryKey: queryKeys.knowledge, queryFn: getKnowledgeArticles });
}

export function useReportMetrics() {
  return useQuery({ queryKey: queryKeys.reports, queryFn: getReportMetrics });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: getSettings });
}
