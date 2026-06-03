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

### Local dev DB breaks after renumbering (`Failed to run the query 'ALTER TABLE ... ADD ...'`)

Renumbering a migration during rebase (e.g. the PR's `0032_*` → regenerated `0033_*`) breaks any **local dev DB that already applied the old-numbered migration**. The better-sqlite3 migrator only compares the single newest `created_at` in `__drizzle_migrations` against each journal entry's `when`, so:

- The renumbered migration (`0033`, later `when`) re-runs and fails with `Failed to run the query 'ALTER TABLE \`apps\` ADD \`...\`'` — the column already exists from the old `0032`.
- Any genuinely-new upstream migration whose `when` is **older** than your last-applied timestamp (e.g. `0032_nostalgic_orphan`) is silently **skipped**, so its columns never get added.

CI and fresh installs are unaffected (they apply `0000→00YY` in order). Fix the dev DB at `./userData/sqlite.db` (dev `getUserDataPath()` = `./userData`) **without wiping data**: build a reference DB by replaying every journalled `.sql` into an in-memory sqlite, diff `PRAGMA table_info` per table against the dev DB to find the truly-missing columns, manually apply the skipped migration's `ALTER`s, then `INSERT INTO __drizzle_migrations (hash, created_at)` a row whose `created_at` = the renumbered migration's journal `when` (hash = `sha256` of the `.sql` file bytes) so the migrator no-ops. Back up `sqlite.db` first. Use Python's stdlib `sqlite3` for this — the bundled `better-sqlite3` is built for Electron's ABI and throws `NODE_MODULE_VERSION` under system Node. "Extra" dev-DB columns from other branches you've run are inert; leave them. Deleting `./userData/sqlite.db` also works but loses local apps/chats.
