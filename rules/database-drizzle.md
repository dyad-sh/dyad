# Database & Drizzle ORM

This app uses SQLite and drizzle ORM.

Generate SQL migrations by running this:

```sh
npm run db:generate
```

IMPORTANT: Do NOT generate SQL migration files by hand! This is wrong.

## Drizzle migration conflicts during rebase

When rebasing a branch that has drizzle migrations conflicting with upstream (e.g., both have `0023_*.sql`):

1. Keep upstream's migration files (they're already deployed to production)
2. Rename the PR's conflicting migration to the next available index (e.g., `0023_romantic_mantis.sql` → `0025_romantic_mantis.sql`)
3. Update `drizzle/meta/_journal.json` to include all migrations with correct indices
4. Create/update the snapshot file (`drizzle/meta/00XX_snapshot.json`) with the new index, updating `prevId` to reference the previous snapshot's `id`
5. If the PR had subsequent commits that deleted/modified its migration files, those changes become no-ops after renaming — just accept the deletion conflicts by staging the renamed files

### Merging snapshot conflicts when both branches modify the same migration number

When both HEAD and your branch create the same migration index (e.g., both create `0025_*.sql` with different changes):

1. **Use HEAD's `id` and timestamp** in the snapshot and journal files (HEAD represents the merged state)
2. **Merge the SQL migrations** by combining both sets of ALTER/CREATE statements into a single file named with HEAD's tag
3. **Merge the snapshot JSON schema** by combining both sets of table/column changes into HEAD's snapshot file
4. Example: If HEAD adds compaction columns and your branch adds `custom_templates` table, the merged `0025_lush_stark_industries.sql` should contain both the `CREATE TABLE custom_templates` and the `ALTER TABLE chats/messages` statements, and the snapshot should include both the new table and new columns
