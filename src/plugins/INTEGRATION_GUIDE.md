# Plugin System Integration Guide

This document describes how to integrate the plugin system into the existing Dyad codebase.

## Overview

The plugin system provides a modular architecture for integrating external services (like Supabase, Neon, Vercel) into Dyad. Each plugin encapsulates:

- **OAuth authentication** - Connecting user accounts
- **Database operations** - SQL execution, schema queries
- **Serverless functions** - Deployment and logs
- **AI agent context** - Providing context to the AI
- **AI agent tools** - Custom tools for the agent
- **System prompts** - AI guidance based on integration status

## File Structure

```
src/plugins/
├── index.ts                    # Main exports and initialization
├── types.ts                    # Core plugin type definitions
├── registry.ts                 # Plugin registry/manager
├── ipc_integration.ts          # IPC handler registration
├── renderer/
│   ├── index.ts               # Renderer-side exports
│   └── hooks/
│       ├── usePlugin.ts       # Generic plugin hooks
│       └── useSupabasePlugin.ts  # Supabase-specific hook
└── supabase/
    ├── index.ts               # Supabase plugin definition
    ├── ipc_handlers.ts        # IPC handlers
    └── capabilities/
        ├── oauth.ts           # OAuth authentication
        ├── database.ts        # Database operations
        ├── functions.ts       # Edge functions
        ├── agent_context.ts   # AI context provider
        ├── agent_tools.ts     # AI agent tools
        └── prompts.ts         # System prompts
```

## Integration Steps

### 1. Initialize Plugin System on App Start

In `src/main/index.ts` or equivalent app initialization:

```typescript
import { initializePluginSystem } from '../plugins';

// During app initialization
async function initializeApp() {
  // ... other initialization

  // Initialize the plugin system
  await initializePluginSystem();
}
```

### 2. Register Plugin IPC Handlers

In `src/ipc/ipc_host.ts`:

```typescript
import { registerPluginIpcHandlers } from '../plugins/ipc_integration';

export function registerIpcHandlers() {
  // ... existing handler registrations

  // Register plugin IPC handlers
  registerPluginIpcHandlers();
}
```

### 3. Use Plugin Hooks in React Components

Replace direct use of `useSupabase` with `useSupabasePlugin`:

```typescript
// Before
import { useSupabase } from '@/hooks/useSupabase';

function MyComponent() {
  const { organizations, projects } = useSupabase();
  // ...
}

// After
import { useSupabasePlugin } from '@/plugins/renderer';

function MyComponent() {
  const { organizations, projects } = useSupabasePlugin();
  // ...
}
```

### 4. Get System Prompts from Plugins

In the AI/agent code:

```typescript
import { getCombinedSystemPrompt } from '../plugins/registry';

async function getSystemPrompt(app: App) {
  // Get prompts from all enabled plugins
  const pluginPrompts = await getCombinedSystemPrompt({
    projectId: app.supabaseProjectId,
    accountId: app.supabaseOrganizationSlug,
  });

  return `${basePrompt}\n\n${pluginPrompts}`;
}
```

### 5. Get Agent Tools from Plugins

```typescript
import { getAllAgentToolDefinitions } from '../plugins/registry';

function getAgentTools() {
  const pluginTools = getAllAgentToolDefinitions();

  return [
    ...builtinTools,
    ...pluginTools.map(({ pluginId, tool }) => ({
      name: `${pluginId}_${tool.name}`,
      ...tool,
    })),
  ];
}
```

## Adding a New Plugin

To add a new plugin (e.g., for Neon):

1. Create the plugin directory: `src/plugins/neon/`

2. Define capabilities:
```typescript
// src/plugins/neon/capabilities/database.ts
import type { DatabaseCapability } from '../../types';

export function createDatabaseCapability(): DatabaseCapability {
  return {
    executeSql: async (params) => { /* ... */ },
    getSchema: async (params) => { /* ... */ },
    listProjects: async () => { /* ... */ },
    linkProject: async (params) => { /* ... */ },
    unlinkProject: async (appId) => { /* ... */ },
    listBranches: async (params) => { /* ... */ },
  };
}
```

3. Create the plugin definition:
```typescript
// src/plugins/neon/index.ts
import type { PluginDefinition } from '../types';
import { createDatabaseCapability } from './capabilities/database';
import { createOAuthCapability } from './capabilities/oauth';

export const neonPlugin: PluginDefinition = {
  metadata: {
    id: 'neon',
    displayName: 'Neon',
    description: 'Serverless Postgres database',
    version: '1.0.0',
    category: 'database',
  },
  capabilities: {
    oauth: createOAuthCapability(),
    database: createDatabaseCapability(),
  },
  ipcHandlers: createNeonIpcHandlers(),
};
```

4. Register the plugin:
```typescript
// src/plugins/index.ts
import { neonPlugin } from './neon';

const BUILTIN_PLUGINS = [supabasePlugin, neonPlugin];
```

## Migration Path

This plugin system is designed to be incrementally adopted:

1. **Phase 1**: Plugin system runs alongside existing code
   - Both old and new IPC handlers work
   - Old hooks and new plugin hooks coexist

2. **Phase 2**: Migrate components one at a time
   - Replace direct IPC calls with plugin system calls
   - Update hooks to use plugin hooks

3. **Phase 3**: Remove legacy code
   - Remove old `supabase_handlers.ts`
   - Remove old `useSupabase.ts`
   - Remove direct Supabase imports from core code

## Benefits

1. **Modularity**: Each integration is self-contained
2. **Testability**: Plugins can be tested independently
3. **Extensibility**: Easy to add new integrations
4. **Consistency**: All integrations follow the same patterns
5. **Discoverability**: All capabilities are typed and documented
6. **Hot-reloading**: Plugins can be enabled/disabled at runtime
