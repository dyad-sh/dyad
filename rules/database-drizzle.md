# Database & Drizzle ORM

This app uses SQLite and drizzle ORM.

Generate SQL migrations by running this:

```sh
npm run db:generate
```

IMPORTANT: Do NOT generate SQL migration files by hand! This is wrong.

## Drizzle migration conflicts during rebase

When rebasing a branch that has drizzle migrations conflicting with upstream (e.g., both have `0026_*.sql`):

1. Keep upstream's migration files (they're already deployed to production)
2. Create the PR's SQL file at the next available index (e.g., if upstream has `N`, use `N+1`) with the same content, then remove the old conflicting one with `git rm -f drizzle/<old_file>.sql` (needs `-f` because the file is staged in the rebase conflict index)
3. Update `drizzle/meta/_journal.json`: keep the conflict zone's HEAD version (upstream migration at idx `N`), then add the PR's migration as a new entry at idx `N+1` after the closing `}`. Ensure the `when` timestamp is greater than the previous entry's timestamp to maintain chronological ordering
4. Resolve `drizzle/meta/<N>_snapshot.json` conflicts — snapshot files typically have **multiple conflict zones**: (a) the `id` UUID field → take HEAD's value, (b) any new columns the PR adds to a table → remove from this snapshot (they go in `N+1`), (c) any new columns upstream added → keep HEAD's version
5. Create `drizzle/meta/<N+1>_snapshot.json` as a **new file**: copy the resolved `<N>_snapshot.json` but set `id` to the PR's original snapshot UUID and `prevId` to the upstream snapshot's `id`; add the PR's new schema changes to the appropriate table
6. If the PR had subsequent commits that deleted/modified its migration files, those changes become no-ops after renaming — just accept the deletion conflicts by staging the renamed files
