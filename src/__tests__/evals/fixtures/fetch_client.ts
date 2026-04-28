// fetch_client.ts — authenticated fetch wrapper used by all service layers

import { getAuthToken } from "./auth";

const BASE_URL =
  process.env.SERVICE_BASE_URL ?? "https://api.internal.example.com";
const DEFAULT_TIMEOUT_MS = 8_000;

export interface FetchClientOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export interface ServiceError {
  code: string;
  message: string;
  status: number;
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  status: string;
  ownerId: string;
  createdAt: string;
}

export interface ProjectMember {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface Subscription {
  id: string;
  plan: string;
  status: string;
  renewsAt: string | null;
}

/**
 * Sends an authenticated request to the internal service API.
 * Throws a ServiceError on non-2xx responses.
 */
export async function serviceRequest<T>(
  path: string,
  options: FetchClientOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const token = await getAuthToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  });
  clearTimeout(timer);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw {
      code: errorBody.code ?? "UNKNOWN_ERROR",
      message: errorBody.message ?? response.statusText,
      status: response.status,
    } satisfies ServiceError;
  }

  return response.json() as Promise<T>;
}

// ── Verb wrappers ──────────────────────────────────────────────────────────

export async function getResource<T>(
  path: string,
  headers?: Record<string, string>,
): Promise<T> {
  const data = await serviceRequest<T>(path, { method: "GET", headers });
  return data;
}

export async function postResource<T>(path: string, body: unknown): Promise<T> {
  const data = await serviceRequest<T>(path, { method: "POST", body });
  return data;
}

export async function putResource<T>(path: string, body: unknown): Promise<T> {
  const data = await serviceRequest<T>(path, { method: "PUT", body });
  return data;
}

export async function patchResource<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const data = await serviceRequest<T>(path, { method: "PATCH", body });
  return data;
}

export async function deleteResource(path: string): Promise<void> {
  const data = await serviceRequest<void>(path, { method: "DELETE" });
  return data;
}

// ── User resources ─────────────────────────────────────────────────────────

export async function getUserProfile(userId: string): Promise<UserProfile> {
  return getResource<UserProfile>(`/users/${userId}`);
}

export async function updateUserProfile(
  userId: string,
  updates: { name?: string; email?: string; avatarUrl?: string },
): Promise<UserProfile> {
  return patchResource<UserProfile>(`/users/${userId}`, updates);
}

export async function deleteUserAccount(userId: string): Promise<void> {
  return deleteResource(`/users/${userId}`);
}

export async function listUsers(
  page = 1,
  limit = 20,
): Promise<PagedResponse<UserProfile>> {
  return getResource<PagedResponse<UserProfile>>(
    `/users?page=${page}&limit=${limit}`,
  );
}

export async function getUserSubscription(
  userId: string,
): Promise<Subscription | null> {
  return getResource<Subscription | null>(`/users/${userId}/subscription`);
}

// ── Project resources ──────────────────────────────────────────────────────

export async function getProjectList(workspaceId: string): Promise<Project[]> {
  return getResource<Project[]>(`/workspaces/${workspaceId}/projects`);
}

export async function createProject(
  workspaceId: string,
  payload: { name: string; template?: string },
): Promise<Project> {
  return postResource<Project>(`/workspaces/${workspaceId}/projects`, payload);
}

export async function getProject(projectId: string): Promise<Project> {
  return getResource<Project>(`/projects/${projectId}`);
}

export async function updateProject(
  projectId: string,
  updates: { name?: string; status?: string },
): Promise<Project> {
  return patchResource<Project>(`/projects/${projectId}`, updates);
}

export async function archiveProject(projectId: string): Promise<void> {
  return postResource<void>(`/projects/${projectId}/archive`, {});
}

export async function deleteProject(projectId: string): Promise<void> {
  return deleteResource(`/projects/${projectId}`);
}

// ── Project membership ─────────────────────────────────────────────────────

export async function getProjectMembers(
  projectId: string,
): Promise<ProjectMember[]> {
  return getResource<ProjectMember[]>(`/projects/${projectId}/members`);
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: string,
): Promise<void> {
  return postResource<void>(`/projects/${projectId}/members`, { userId, role });
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<void> {
  return deleteResource(`/projects/${projectId}/members/${userId}`);
}

export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: string,
): Promise<ProjectMember> {
  return patchResource<ProjectMember>(
    `/projects/${projectId}/members/${userId}`,
    { role },
  );
}

// ── Workspace resources ────────────────────────────────────────────────────

export async function getWorkspace(
  workspaceId: string,
): Promise<{ id: string; name: string; plan: string }> {
  return getResource(`/workspaces/${workspaceId}`);
}

export async function updateWorkspace(
  workspaceId: string,
  updates: { name?: string },
): Promise<{ id: string; name: string }> {
  return patchResource(`/workspaces/${workspaceId}`, updates);
}

// ── Billing resources ──────────────────────────────────────────────────────

export interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void";
  dueDate: string;
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  type: "card" | "bank_account";
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
}

export async function listInvoices(workspaceId: string): Promise<Invoice[]> {
  return getResource<Invoice[]>(`/workspaces/${workspaceId}/billing/invoices`);
}

export async function getInvoice(invoiceId: string): Promise<Invoice> {
  return getResource<Invoice>(`/billing/invoices/${invoiceId}`);
}

export async function downloadInvoicePdf(invoiceId: string): Promise<Blob> {
  const token = await getAuthToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const response = await fetch(
    `${BASE_URL}/billing/invoices/${invoiceId}/pdf`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    },
  );
  clearTimeout(timer);

  if (!response.ok) {
    throw {
      code: "DOWNLOAD_FAILED",
      message: "Failed to download invoice PDF",
      status: response.status,
    } satisfies ServiceError;
  }
  return response.blob();
}

export async function listPaymentMethods(
  workspaceId: string,
): Promise<PaymentMethod[]> {
  return getResource<PaymentMethod[]>(
    `/workspaces/${workspaceId}/billing/payment-methods`,
  );
}

export async function addPaymentMethod(
  workspaceId: string,
  token: string,
): Promise<PaymentMethod> {
  return postResource<PaymentMethod>(
    `/workspaces/${workspaceId}/billing/payment-methods`,
    { token },
  );
}

export async function removePaymentMethod(
  workspaceId: string,
  paymentMethodId: string,
): Promise<void> {
  return deleteResource(
    `/workspaces/${workspaceId}/billing/payment-methods/${paymentMethodId}`,
  );
}

export async function setDefaultPaymentMethod(
  workspaceId: string,
  paymentMethodId: string,
): Promise<void> {
  return postResource<void>(
    `/workspaces/${workspaceId}/billing/payment-methods/${paymentMethodId}/set-default`,
    {},
  );
}
