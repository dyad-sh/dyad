# Memory System Design Plan

## Problem Statement

Dyad currently has no persistent memory across chat sessions. Each new chat starts with zero context about user preferences, past decisions, or project-specific patterns learned in previous conversations. This means users repeatedly re-explain the same preferences, and the AI cannot learn from past interactions.

## Requirements

1. **Persistent memory**: Memories survive across chats and app restarts
2. **Per-app scoping**: Memories are scoped to individual apps (different projects have different contexts)
3. **Toggleable**: Users can enable/disable memory via a setting
4. **Manageable**: Users can view and delete individual memories
5. **Injected into context**: Relevant memories are included in the system prompt
6. **Bounded size**: Memory doesn't grow unbounded and consume the entire context window

---

## Option 1: Dependency-Free SQLite Storage (RECOMMENDED)

### Description

Store memories as plain text entries in a new SQLite table using the existing Drizzle ORM setup. Memories are simple key-value-like entries with content and metadata. The AI model extracts memories from conversations and the system injects them into the system prompt.

### Architecture

- **Storage**: New `memories` table in the existing SQLite database
- **Extraction**: At the end of each chat response, the AI is asked (via a lightweight follow-up call) to extract noteworthy facts/preferences
- **Injection**: Before each chat request, all memories for the current app are fetched and appended to the system prompt
- **Management**: CRUD IPC endpoints for viewing/deleting memories

### Schema

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### Pros

- Zero new dependencies
- Uses existing infrastructure (SQLite, Drizzle, IPC contract system)
- Simple to implement and maintain
- Fast lookups (all memories for an app is a single indexed query)
- Works offline
- No external API calls for storage/retrieval

### Cons

- No semantic search (all memories for an app are included)
- Requires a secondary LLM call for memory extraction (adds latency + cost)
- Memory relevance depends on manual curation or simple heuristics

### Estimated Complexity

Low — follows existing patterns exactly (similar to prompts table).

---

## Option 2: Vector Embeddings with `vectra` (Open Source)

### Description

Use [vectra](https://github.com/Stevenic/vectra), a local vector database for Node.js, to store memories as embeddings. This enables semantic search so only relevant memories are retrieved per query.

### Architecture

- **Storage**: Local JSON-based vector index (one per app) managed by vectra
- **Embeddings**: Use the configured AI provider's embedding API (or a local model)
- **Retrieval**: Semantic similarity search on user's current prompt to find top-K relevant memories
- **Injection**: Only semantically relevant memories are injected into context

### Pros

- Semantic search means only relevant memories are included
- Scales better with large memory stores
- Open source (MIT license)

### Cons

- **New dependency** (`vectra`)
- Requires an embedding model (external API call or local model)
- More complex implementation (vector index management, embedding pipeline)
- Embedding API adds latency and cost to every chat message
- JSON-based storage may not be as robust as SQLite
- Offline support depends on embedding model availability

### Estimated Complexity

Medium-High — new dependency, embedding pipeline, vector index management.

---

## Option 3: Vector Embeddings with `lancedb` (Open Source)

### Description

Use [LanceDB](https://github.com/lancedb/lancedb), an embedded vector database, for storage and retrieval. Similar to Option 2 but with a more robust storage engine.

### Pros

- Columnar storage format (efficient for large datasets)
- Semantic search with vector similarity
- Open source (Apache 2.0)
- Embedded (no server needed)

### Cons

- **Heavy dependency** (native binaries, ~50MB+)
- Requires embedding model (same issues as Option 2)
- Significantly increases app bundle size
- Complex build pipeline for native modules across platforms
- Overkill for the expected memory volume (tens to hundreds of entries per app)

### Estimated Complexity

High — native dependency management, cross-platform builds, embedding pipeline.

---

## Option 4: Hybrid — SQLite Storage + LLM-based Relevance Filtering

### Description

Store memories in SQLite (like Option 1) but use the LLM itself to filter which memories are relevant before injection. When memory count exceeds a threshold, ask the model to select the N most relevant memories given the current prompt.

### Pros

- No new dependencies
- Better relevance filtering than including all memories
- Uses existing infrastructure

### Cons

- Extra LLM call for filtering adds latency
- Cost scales with memory count (more tokens to evaluate)
- Filtering quality depends on model capability
- For small memory stores (<50 entries), the overhead isn't worth it

### Estimated Complexity

Low-Medium — same as Option 1 plus an optional filtering step.

---

## Decision: Option 1 (Dependency-Free SQLite Storage)

### Rationale

1. **Simplicity**: The expected memory volume per app (tens of entries) doesn't justify vector search infrastructure
2. **Zero dependencies**: No new packages to maintain, audit, or worry about cross-platform compatibility
3. **Follows existing patterns**: The implementation mirrors the existing `prompts` table exactly
4. **Incremental**: Can always upgrade to semantic search later if memory volume warrants it
5. **Offline-first**: Works entirely offline with no external API calls for storage/retrieval
6. **Memory extraction**: Rather than an expensive secondary LLM call, we let users manually add memories and also auto-extract them from chat summaries

### Implementation Plan

1. Add `memories` table to Drizzle schema
2. Generate migration with `npm run db:generate`
3. Create IPC contracts (`memory.ts`) for CRUD operations
4. Create IPC handlers (`memory_handlers.ts`)
5. Register handlers in `ipc_host.ts`
6. Add `enableMemory` setting to `UserSettingsSchema`
7. Create `MemorySwitch` component for settings page
8. Add query keys to `queryKeys.ts`
9. Inject memories into system prompt in `chat_stream_handlers.ts`
10. Create memory management UI component
