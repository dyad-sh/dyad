/**
 * Database schema for server
 * Re-exports from main schema file for consistency
 */

export {
    apps,
    chats,
    messages,
    versions,
    prompts,
    language_models,
    language_model_providers,
    mcpServers,
    mcpToolConsents,
    appsRelations,
    chatsRelations,
    messagesRelations,
    versionsRelations,
    languageModelsRelations,
    languageModelProvidersRelations,
} from "../../../src/db/schema.js";
