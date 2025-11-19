import { describe, it, expect } from "vitest";
import {
  apps,
  chats,
  messages,
  versions,
  language_models,
  language_model_providers,
  mcpServers,
  mcpToolConsents,
  prompts,
} from "../db/schema";

describe("Database Schema", () => {
  describe("Apps Table", () => {
    it("should have correct structure", () => {
      expect(apps).toBeDefined();
      expect(apps.id).toBeDefined();
      expect(apps.name).toBeDefined();
      expect(apps.path).toBeDefined();
      expect(apps.createdAt).toBeDefined();
      expect(apps.updatedAt).toBeDefined();
    });

    it("should have integration fields", () => {
      expect(apps.githubOrg).toBeDefined();
      expect(apps.githubRepo).toBeDefined();
      expect(apps.githubBranch).toBeDefined();
      expect(apps.supabaseProjectId).toBeDefined();
      expect(apps.neonProjectId).toBeDefined();
      expect(apps.vercelProjectId).toBeDefined();
    });

    it("should have favorite field", () => {
      expect(apps.isFavorite).toBeDefined();
    });
  });

  describe("Chats Table", () => {
    it("should have correct structure", () => {
      expect(chats).toBeDefined();
      expect(chats.id).toBeDefined();
      expect(chats.appId).toBeDefined();
      expect(chats.title).toBeDefined();
      expect(chats.createdAt).toBeDefined();
    });

    it("should have initial commit tracking", () => {
      expect(chats.initialCommitHash).toBeDefined();
    });
  });

  describe("Messages Table", () => {
    it("should have correct structure", () => {
      expect(messages).toBeDefined();
      expect(messages.id).toBeDefined();
      expect(messages.chatId).toBeDefined();
      expect(messages.role).toBeDefined();
      expect(messages.content).toBeDefined();
      expect(messages.createdAt).toBeDefined();
    });

    it("should have approval state", () => {
      expect(messages.approvalState).toBeDefined();
    });

    it("should have commit hash tracking", () => {
      expect(messages.commitHash).toBeDefined();
    });

    it("should have request ID tracking", () => {
      expect(messages.requestId).toBeDefined();
    });
  });

  describe("Versions Table", () => {
    it("should have correct structure", () => {
      expect(versions).toBeDefined();
      expect(versions.id).toBeDefined();
      expect(versions.appId).toBeDefined();
      expect(versions.commitHash).toBeDefined();
      expect(versions.createdAt).toBeDefined();
      expect(versions.updatedAt).toBeDefined();
    });

    it("should have Neon timestamp tracking", () => {
      expect(versions.neonDbTimestamp).toBeDefined();
    });
  });

  describe("Language Models Tables", () => {
    it("should have providers table", () => {
      expect(language_model_providers).toBeDefined();
      expect(language_model_providers.id).toBeDefined();
      expect(language_model_providers.name).toBeDefined();
      expect(language_model_providers.api_base_url).toBeDefined();
    });

    it("should have models table", () => {
      expect(language_models).toBeDefined();
      expect(language_models.id).toBeDefined();
      expect(language_models.displayName).toBeDefined();
      expect(language_models.apiName).toBeDefined();
    });

    it("should have custom provider reference", () => {
      expect(language_models.customProviderId).toBeDefined();
      expect(language_models.builtinProviderId).toBeDefined();
    });
  });

  describe("MCP Tables", () => {
    it("should have MCP servers table", () => {
      expect(mcpServers).toBeDefined();
      expect(mcpServers.id).toBeDefined();
      expect(mcpServers.name).toBeDefined();
      expect(mcpServers.transport).toBeDefined();
      expect(mcpServers.enabled).toBeDefined();
    });

    it("should have MCP tool consents table", () => {
      expect(mcpToolConsents).toBeDefined();
      expect(mcpToolConsents.id).toBeDefined();
      expect(mcpToolConsents.serverId).toBeDefined();
      expect(mcpToolConsents.toolName).toBeDefined();
      expect(mcpToolConsents.consent).toBeDefined();
    });
  });

  describe("Prompts Table", () => {
    it("should have correct structure", () => {
      expect(prompts).toBeDefined();
      expect(prompts.id).toBeDefined();
      expect(prompts.title).toBeDefined();
      expect(prompts.content).toBeDefined();
      expect(prompts.createdAt).toBeDefined();
      expect(prompts.updatedAt).toBeDefined();
    });
  });
});
