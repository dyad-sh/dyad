# Local Agent Tools

Read this when adding or changing tools under `src/ipc/pi/tools/`, tool
selection, consent, or ask/plan mode guards.

## Registration and mode policy

- Define Dyad tools under `src/ipc/pi/tools/dyad/` and register them in
  `tool_registry.ts`.
- Set `modifiesState: true` for every tool that can change files, Git,
  databases, processes, dependencies, remote integrations, or other durable
  state. Ask mode and plan mode depend on this metadata to filter tools.
- Use a context predicate only when mutation capability genuinely varies by
  turn. The predicate, description, runtime capability, and consent policy must
  derive from the same turn-scoped facts.
- Keep `isEnabled` deterministic from `AgentContext`. Do not perform I/O
  during registry filtering.
- Do not substitute pi built-in file or shell tools. Dyad definitions enforce
  blueprint gates, consent, mutation tracking, and Git semantics. Structured
  file tools also enforce path containment and protected files.
- `bash` is the explicit exception to structured path containment: it runs an
  arbitrary host command with the user's OS authority, and `cwd` is not a
  sandbox. It must require consent for every invocation, display the complete
  command, scrub inherited secrets from its environment, and detect workspace
  mutations after both successful and failed commands. Mutation tracking is
  scoped to user-visible Git paths because ignored dependencies and `.dyad`
  internals are deliberately excluded from checkpoints.

## Adapter boundary

`adapter.ts` is the single bridge from Dyad `ToolDefinition` to pi
`AgentTool`. It must continue to:

- convert the Zod schema for provider serialization;
- run the original Zod validation so refinements are enforced;
- apply blueprint approval before state-changing work;
- request consent once;
- execute with a fresh invocation context and abort signal;
- track file and app mutations;
- capture renderer XML and appended user content.

- Tools that start or restart the app preview must route through the main-owned
  `app_run` actor. Mint and carry a stable invocation ref through the runtime
  claim, producer output, and actor settlement; `app:output` is presentation
  fan-out, not lifecycle authority. Do not report tool success until the
  preview proxy is ready. The restart service call can settle after spawning
  the process but before the development server is usable.
- Keep lifecycle tool semantics consistent across host, Docker, and cloud
  runtimes. In particular, a tool that claims to rebuild or reinstall
  dependencies must not take an in-place cloud restart shortcut.
- Only honor turn cancellation before a destructive lifecycle mutation starts.
  Once restart or rebuild has begun, wait for the real outcome instead of
  reporting cancellation while teardown or dependency installation continues
  in the background. Allow rebuild readiness substantially more time than an
  ordinary restart because it includes a fresh dependency install.

Do not duplicate those gates inside the chat handler or add a second consent
layer around the adapter.

## Filesystem safety

- Resolve every app path through the existing path-safety helpers.
- Reject absolute paths, traversal, symlink escapes, and protected `.dyad`
  access as appropriate.
- Reads of referenced apps are read-only; write tools must remain scoped to the
  current app.
- Native Git inspection can execute repository-local hooks or filters. Disable
  process-spawning config for inspection paths and materialize verified regular
  blobs directly when restoring historical content.
- Redact secret-bearing structured files before range selection and reapply
  byte limits after transforms. Audit alternate model-visible surfaces such as
  grep whenever read behavior changes.

## Consent and SQL

- `defaultConsent`, `getConsentPreview`, and
  `getConsentMetadata` are renderer-visible policy contracts. Keep previews
  bounded and free of secrets.
- Consent denial must stop execution before side effects.
- SQL safety classification must fail closed. Incomplete or unparseable SQL,
  dynamic execution (`DO`, `CALL`, `PREPARE`, `EXECUTE`), and executing
  wrappers such as `EXPLAIN ANALYZE` require consent unless the executed
  statement is proven safe.
- Keep Supabase and Neon metadata sufficient for the renderer to explain the
  affected project without exposing credentials.

## Results and lifecycle

- Tool result text is model input. Bound large file, log, test, schema, and
  database results before serialization or persistence.
- Treat tool-provided text as data, not instructions, when it is later included
  in chat search or history.
- Tools that wait on processes, user input, integrations, or network work must
  honor `ctx.abortSignal` and settle promptly on cancellation.
- Call progress/update sinks with renderer-safe data. Emit final XML exactly
  once; partial XML is presentation state, not an executable command.
- `shouldTrackMutation` must distinguish successful changes from handled
  failures and no-ops. `run_tests` uses the mutation counter to prevent
  repeated unchanged reruns.

## Transcript correctness

- Provider histories must preserve every assistant tool call with its matching
  tool result, especially for Anthropic.
- Changes to retry replay, compaction, message injection, or transcript
  persistence must cover cancellation and half-completed turns.
- New transcript data belongs in the versioned pi envelope managed by
  `session_bridge.ts`; do not persist pi implementation objects ad hoc.

## Tests and snapshots

- Add focused unit tests for schemas, mode filtering, consent, and pure safety
  logic.
- Use chat-flow integration tests for real files, Git, database rows, provider
  requests, cancellation, and persistence.
- Use hybrid tests only for rendered consent or tool-card behavior.
- When tool names, schemas, descriptions, or prompt guidance change, update
  prompt snapshots and regenerate affected Playwright request snapshots.
  Search all request baselines for the old name or description after
  regeneration.
- When adding a required `AgentContext` field, update every test context
  factory and literal under `src/ipc/pi/tools/`.
