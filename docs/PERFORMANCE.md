# Performance Optimization Guide

This guide helps you optimize Dyad for better performance, faster load times, and lower resource usage.

## Table of Contents

- [Application Performance](#application-performance)
- [Database Optimization](#database-optimization)
- [Bundle Size Optimization](#bundle-size-optimization)
- [Memory Management](#memory-management)
- [Network Optimization](#network-optimization)
- [Development Performance](#development-performance)

## Application Performance

### Startup Time

**Reduce Initial Load Time:**

1. **Code Splitting** (Already Configured)
   - Routes are lazy-loaded automatically
   - Heavy dependencies (Monaco, Lexical) in separate chunks
   - Vendor libraries split by category

2. **ASAR Packaging**
   - Code is packaged in ASAR for faster access
   - Selective unpacking for native modules
   - Enabled by default in production builds

3. **Database Optimization**
   - Indexes added on frequently queried columns (v0.27.0+):
     - `chats.appId`
     - `messages.chatId`
     - `messages.requestId`
     - `versions.appId`
     - `language_models.customProviderId`
     - `mcpToolConsents.serverId`

**Measure Startup Time:**

```bash
# Enable performance logging
DEBUG=dyad:performance npm start
```

### Runtime Performance

**UI Responsiveness:**

1. **Use React.memo for expensive components**
   ```typescript
   const MyComponent = React.memo(({ data }) => {
     // Component logic
   });
   ```

2. **Debounce expensive operations**
   ```typescript
   const debouncedSearch = useMemo(
     () => debounce(search, 300),
     [search]
   );
   ```

3. **Virtualize long lists**
   - Already implemented for chat messages
   - Consider for large app/file lists

4. **Optimize re-renders**
   - Use Jotai atoms for granular state
   - Avoid unnecessary context updates
   - Use `useCallback` for callbacks

**Monitor Performance:**

```typescript
// Use React DevTools Profiler
import { Profiler } from "react";

<Profiler id="MyComponent" onRender={onRenderCallback}>
  <MyComponent />
</Profiler>
```

### AI Response Performance

**Optimize Context Window:**

1. **Smart Context (Pro Feature)**
   - Automatically filters relevant files
   - Reduces token count by 60-80%
   - Faster responses from AI

2. **Manual Context Control**
   - Select specific files in context
   - Use `.dyadignore` to exclude files
   - Limit context to relevant directories

3. **Streaming Responses**
   - Already enabled for all AI providers
   - Shows partial responses immediately
   - Better perceived performance

## Database Optimization

### Query Optimization

**Use Indexes (Already Configured):**

```sql
-- Automatically created indexes:
CREATE INDEX chats_app_id_idx ON chats(app_id);
CREATE INDEX messages_chat_id_idx ON messages(chat_id);
CREATE INDEX messages_request_id_idx ON messages(request_id);
CREATE INDEX versions_app_id_idx ON versions(app_id);
```

**Optimize Queries:**

```typescript
// Good - Uses index
const chats = await db.query.chats.findMany({
  where: eq(chats.appId, appId),
  orderBy: desc(chats.createdAt),
  limit: 20,
});

// Bad - No limit, fetches all
const chats = await db.query.chats.findMany({
  where: eq(chats.appId, appId),
});
```

**Use Transactions:**

```typescript
await db.transaction(async (tx) => {
  await tx.insert(chats).values(chatData);
  await tx.insert(messages).values(messageData);
});
```

### Database Maintenance

**Vacuum Database Periodically:**

```bash
sqlite3 ~/.config/dyad/dyad.db "VACUUM;"
```

**Analyze Query Plans:**

```bash
sqlite3 ~/.config/dyad/dyad.db "EXPLAIN QUERY PLAN SELECT * FROM chats WHERE app_id = 1;"
```

**Monitor Database Size:**

```bash
du -h ~/.config/dyad/dyad.db
```

## Bundle Size Optimization

### Code Splitting (Configured)

Vite automatically splits the bundle into optimized chunks:

- `vendor-react` - React and React DOM
- `vendor-monaco` - Monaco Editor
- `vendor-radix` - Radix UI components
- `vendor-tanstack` - TanStack Router & Query
- `vendor-ai` - AI SDK
- `vendor-lexical` - Lexical editor
- `vendor-markdown` - Markdown rendering & syntax highlighting
- `components-settings` - Settings UI
- `components-chat` - Chat UI

**Analyze Bundle Size:**

```bash
npm run build
npx vite-bundle-visualizer
```

### Tree Shaking

**Ensure proper imports:**

```typescript
// Good - Tree-shakeable
import { Button } from "@/components/ui/button";

// Bad - Imports entire library
import * as Components from "@/components/ui";
```

### Dynamic Imports

**Lazy load heavy components:**

```typescript
const MonacoEditor = React.lazy(() => import("@monaco-editor/react"));

<Suspense fallback={<Loading />}>
  <MonacoEditor />
</Suspense>
```

## Memory Management

### Prevent Memory Leaks

**Clean up subscriptions:**

```typescript
useEffect(() => {
  const subscription = observable.subscribe(handler);
  return () => subscription.unsubscribe();
}, []);
```

**Dispose Monaco editors:**

```typescript
useEffect(() => {
  return () => {
    editorRef.current?.dispose();
  };
}, []);
```

**Limit MCP client instances:**

```typescript
// Reuse clients, don't create new ones
const client = mcpClients.get(serverId) || createClient(serverId);
```

### Monitor Memory Usage

**Chrome DevTools:**
1. View → Toggle Developer Tools
2. Performance tab → Memory
3. Take heap snapshots
4. Compare snapshots to find leaks

**Electron Process Monitor:**

```bash
# In DevTools Console
process.memoryUsage()
```

### Memory Limits

**Increase if needed:**

```json
{
  "scripts": {
    "start": "NODE_OPTIONS='--max-old-space-size=4096' electron-forge start"
  }
}
```

## Network Optimization

### API Calls

**Use caching:**

```typescript
// TanStack Query automatically caches
const { data } = useQuery({
  queryKey: ["apps"],
  queryFn: getApps,
  staleTime: 5 * 60 * 1000, // 5 minutes
});
```

**Batch requests:**

```typescript
// Good - Single request
const apps = await Promise.all([
  getApps(),
  getChats(),
  getMessages(),
]);

// Bad - Sequential requests
const apps = await getApps();
const chats = await getChats();
const messages = await getMessages();
```

**Optimize AI Streaming:**

```typescript
// Use streaming for all AI responses
const stream = await streamText({
  model: openai("gpt-4"),
  prompt: message,
});
```

### Asset Loading

**Optimize images:**
- Use appropriate formats (WebP, AVIF)
- Lazy load images below the fold
- Use proper image dimensions

**Preload critical assets:**

```html
<link rel="preload" href="critical.woff2" as="font" />
```

## Development Performance

### Build Performance

**Parallel builds:**

```bash
# Already configured in tsconfig
"composite": true,
"incremental": true
```

**Disable source maps in production:**

```typescript
// vite.config.ts
build: {
  sourcemap: false, // Disable in production
}
```

### Hot Module Replacement

**Vite HMR is enabled by default**

**Optimize HMR:**
- Keep components small
- Use React Fast Refresh
- Avoid side effects in module scope

### Test Performance

**Run tests in parallel:**

```bash
# Playwright (already configured)
npx playwright test --workers=4

# Vitest (already configured)
npm run test
```

**Use test sharding in CI:**

```bash
# Already configured in CI
npx playwright test --shard=1/4
```

## Performance Monitoring

### Metrics to Track

1. **Startup Time**
   - Time to interactive
   - Time to first render
   - Bundle load time

2. **Runtime Performance**
   - UI responsiveness (FPS)
   - Memory usage
   - CPU usage

3. **Database Performance**
   - Query execution time
   - Database size
   - Index usage

4. **Network Performance**
   - API response time
   - AI streaming latency
   - Upload/download speed

### Profiling Tools

**React DevTools Profiler:**
- Flamegraph view
- Ranked view
- Component timings

**Chrome DevTools Performance:**
- Record runtime performance
- Analyze main thread activity
- Identify bottlenecks

**Lighthouse:**

```bash
# Run Lighthouse audit
lighthouse http://localhost:5173 --view
```

## Best Practices

1. **Measure before optimizing**
   - Profile to find bottlenecks
   - Set performance budgets
   - Track metrics over time

2. **Optimize critical path**
   - Focus on startup time
   - Lazy load non-critical features
   - Defer heavy computations

3. **Use production builds for testing**
   ```bash
   npm run make
   ```

4. **Monitor in production**
   - PostHog analytics enabled
   - Error tracking
   - Performance monitoring

5. **Regular maintenance**
   - Update dependencies
   - Run database vacuum
   - Clean up old data

## Performance Checklist

- [ ] Database indexes added
- [ ] Code splitting configured
- [ ] Bundle size analyzed
- [ ] Memory leaks checked
- [ ] API calls cached
- [ ] Images optimized
- [ ] Tests run in parallel
- [ ] Production build tested
- [ ] Performance metrics tracked
- [ ] Error boundaries added

## Benchmarks

Target performance metrics:

- **Startup time**: < 2 seconds (cold start)
- **Time to interactive**: < 1 second
- **Bundle size**: < 5MB (main chunk)
- **Memory usage**: < 500MB (idle)
- **Database queries**: < 10ms (indexed)
- **AI first token**: < 500ms

## Resources

- [React Performance](https://react.dev/learn/render-and-commit)
- [Vite Performance](https://vitejs.dev/guide/performance.html)
- [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [SQLite Optimization](https://www.sqlite.org/optoverview.html)

## Related Documentation

- [Architecture](./architecture.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
- [IPC API](./IPC_API.md)
- [Contributing](../CONTRIBUTING.md)
