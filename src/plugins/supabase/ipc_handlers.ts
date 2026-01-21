/**
 * Supabase Plugin IPC Handlers
 *
 * Defines IPC handlers for the Supabase plugin that are registered
 * with the plugin system.
 */

import type { PluginIpcHandler } from "../types";
import { createOAuthCapability } from "./capabilities/oauth";
import { createDatabaseCapability } from "./capabilities/database";
import { createFunctionsCapability } from "./capabilities/functions";

// ─────────────────────────────────────────────────────────────────────
// IPC Handler Definitions
// ─────────────────────────────────────────────────────────────────────

/**
 * Creates all IPC handlers for the Supabase plugin.
 * These handlers use the plugin's capabilities to implement the functionality.
 */
export function createSupabaseIpcHandlers(): PluginIpcHandler[] {
  const oauth = createOAuthCapability();
  const database = createDatabaseCapability();
  const functions = createFunctionsCapability();

  return [
    // ─────────────────────────────────────────────────────────────────
    // OAuth Handlers
    // ─────────────────────────────────────────────────────────────────

    {
      channel: "list-organizations",
      handler: async () => {
        const accounts = await oauth.listAccounts();
        return accounts.map((account) => ({
          organizationSlug: account.id,
          name: account.name,
          ownerEmail: account.email,
        }));
      },
    },

    {
      channel: "delete-organization",
      handler: async (_, { organizationSlug }: { organizationSlug: string }) => {
        await oauth.disconnectAccount(organizationSlug);
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Project/Database Handlers
    // ─────────────────────────────────────────────────────────────────

    {
      channel: "list-all-projects",
      handler: async () => {
        const projects = await database.listProjects();
        return projects.map((project) => ({
          id: project.id,
          name: project.name,
          region: project.region,
          organizationSlug: project.accountId,
        }));
      },
    },

    {
      channel: "list-branches",
      handler: async (
        _,
        {
          projectId,
          organizationSlug,
        }: { projectId: string; organizationSlug?: string },
      ) => {
        const branches = await database.listBranches!({
          projectId,
          accountId: organizationSlug,
        });
        return branches.map((branch) => ({
          id: branch.id,
          name: branch.name,
          isDefault: branch.isDefault,
          projectRef: branch.projectRef,
          parentProjectRef: branch.parentProjectRef,
        }));
      },
    },

    {
      channel: "set-app-project",
      handler: async (
        _,
        {
          projectId,
          appId,
          parentProjectId,
          organizationSlug,
        }: {
          projectId: string;
          appId: number;
          parentProjectId?: string;
          organizationSlug: string;
        },
      ) => {
        await database.linkProject({
          appId,
          projectId,
          accountId: organizationSlug,
          parentProjectId,
        });
      },
    },

    {
      channel: "unset-app-project",
      handler: async (_, { app }: { app: number }) => {
        await database.unlinkProject(app);
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Edge Function Handlers
    // ─────────────────────────────────────────────────────────────────

    {
      channel: "get-edge-logs",
      handler: async (
        _,
        {
          projectId,
          timestampStart,
          appId,
          organizationSlug,
        }: {
          projectId: string;
          timestampStart?: number;
          appId: number;
          organizationSlug: string | null;
        },
      ) => {
        const logs = await functions.getLogs({
          projectId,
          timestampStart,
          accountId: organizationSlug ?? undefined,
        });

        // Transform to ConsoleEntry format expected by the frontend
        return logs.map((log) => ({
          level: log.level,
          type: "edge-function" as const,
          message: log.message,
          timestamp: log.timestamp,
          sourceName: log.functionName,
          appId,
        }));
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Test-only Handlers
    // ─────────────────────────────────────────────────────────────────

    {
      channel: "fake-connect-and-set-project",
      testOnly: true,
      handler: async (
        event,
        { appId, fakeProjectId }: { appId: number; fakeProjectId: string },
      ) => {
        const fakeOrgId = "fake-org-id";

        // Store fake credentials
        await oauth.handleOAuthReturn({
          accessToken: "fake-access-token",
          refreshToken: "fake-refresh-token",
          expiresIn: 3600,
          accountId: fakeOrgId,
        });

        // Link the project
        await database.linkProject({
          appId,
          projectId: fakeProjectId,
          accountId: fakeOrgId,
        });

        // Send fake deep link event
        const { safeSend } = await import("../../ipc/utils/safe_sender");
        safeSend(event.sender, "deep-link-received", {
          type: "supabase-oauth-return",
          url: "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
        });
      },
    },
  ];
}
