# Prompt Guides

- When editing `src/prompts/guides/*.md`, run the prompt snapshot tests that consume those guides. For Neon auth guide changes, use `npm test -- src/prompts/neon_prompt.test.ts -u` and commit the updated `src/prompts/__snapshots__/neon_prompt.test.ts.snap`; otherwise `npm test` fails with `Snapshot ... mismatched`.
