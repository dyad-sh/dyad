import { appSettings } from "@/data/settings";
import { automations } from "@/data/automations";
import { customers } from "@/data/customers";
import { deployments } from "@/data/deployments";
import { incidents } from "@/data/incidents";
import { knowledgeArticles } from "@/data/knowledge";
import { projects } from "@/data/projects";
import { reportMetrics } from "@/data/reportMetrics";
import { calculateDeploymentHealth } from "@/lib/deployments";
import { summarizeIncidentLoad } from "@/lib/incidents";

const pause = async () => Promise.resolve();

export async function getProjects() {
  await pause();
  return projects;
}

export async function getProject(id: string) {
  await pause();
  return projects.find((project) => project.id === id) ?? null;
}

export async function getCustomers() {
  await pause();
  return customers;
}

export async function getCustomer(id: string) {
  await pause();
  return customers.find((customer) => customer.id === id) ?? null;
}

export async function getIncidents() {
  await pause();
  return incidents;
}

export async function getIncident(id: string) {
  await pause();
  return incidents.find((incident) => incident.id === id) ?? null;
}

export async function getDeployments() {
  await pause();
  return deployments;
}

export async function getAutomations() {
  await pause();
  return automations;
}

export async function getKnowledgeArticles() {
  await pause();
  return knowledgeArticles;
}

export async function getReportMetrics() {
  await pause();
  return reportMetrics;
}

export async function getSettings() {
  await pause();
  return appSettings;
}

export async function getWorkspaceOverview() {
  await pause();
  return {
    projects: projects.length,
    customers: customers.length,
    automations: automations.filter((automation) => automation.enabled).length,
    incidentLoad: summarizeIncidentLoad(incidents),
    deploymentHealth: calculateDeploymentHealth(deployments),
    revenue: customers.reduce((sum, customer) => sum + customer.arr, 0),
  };
}
