# Database & Drizzle ORM

This app uses SQLite and drizzle ORM.

Generate SQL migrations by running this:

```sh
npm run db:generate
```

IMPORTANT: Do NOT generate SQL migration files by hand! This is wrong.

## Neon migration preview

When diffing Neon branches with `ts-pg-schema-diff`, use unpooled connection
URIs. Neon pooled `-pooler` hosts reject PostgreSQL startup `options` like
`statement_timeout` with `unsupported startup parameter in options`.

## Drizzle migration conflicts during rebase

When rebasing a branch that has drizzle migrations conflicting with upstream (e.g., both have `0028_*.sql`), prefer regenerating over manually editing snapshot/journal files:

1. During the conflict, accept upstream's `drizzle/meta/_journal.json` and `drizzle/meta/00XX_snapshot.json` with `git checkout --ours <file>` (in a rebase, `--ours` = the branch being rebased onto, i.e. upstream).
2. Force-remove the PR's conflicting `drizzle/00XX_*.sql` with `git rm -f` (it's staged as a new file and must be unstaged via `-f`).
3. Stage the resolved metadata and run `git rebase --continue`. Verify `src/db/schema.ts` still contains the PR's schema additions (e.g., `nitroEnabled` column) — the rebase usually merges these correctly.
4. After the rebase completes, run `npm run db:generate` — drizzle-kit will compare the schema to the latest snapshot and emit a fresh `00YY_*.sql` and `00YY_snapshot.json` with the correct next index and `prevId`.
5. Commit the regenerated migration. Either as a separate commit (e.g., `chore(db): renumber migration to 00YY after rebase`), or — to keep each commit's schema and migration self-consistent — fold it back into the commit that introduced the schema change: `git add drizzle/ && git commit --fixup=<schema-commit-sha>` then `GIT_SEQUENCE_EDITOR=true GIT_EDITOR=true git rebase -i --autosquash upstream/main`. The autosquash is conflict-free since the regenerated files are new.

This avoids manual snapshot/journal editing and `prevId` mistakes. Verify afterward with `npm run db:generate` — it should report `No schema changes, nothing to migrate` if the snapshot is cumulative and consistent.
