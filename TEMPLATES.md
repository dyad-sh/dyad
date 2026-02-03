# Template Reorganization Plan

## Summary

Move built-in templates from Hub to Library. Hub becomes a browse-only community template showcase. Add custom template support to Library. Move Neon into an "Integrations" sub-section in Library.

---

## Phase 1: Database — Add `customTemplates` table

**File: `src/db/schema.ts`**

- Add `customTemplates` table with fields: `id`, `name`, `description` (nullable), `githubUrl`, `imageUrl` (nullable), `createdAt`, `updatedAt`
- Run `npm run db:generate` to create migration

---

## Phase 2: IPC Types — Custom template contracts

**File: `src/ipc/types/templates.ts`**

- Add `CustomTemplateSchema`, `CreateCustomTemplateParamsSchema`, `UpdateCustomTemplateParamsSchema`, `DeleteCustomTemplateParamsSchema`
- Add 4 new contracts to `templateContracts`: `getCustomTemplates`, `createCustomTemplate`, `updateCustomTemplate`, `deleteCustomTemplate`
- Export new types from `src/ipc/types/index.ts`

---

## Phase 3: IPC Handlers — Custom template CRUD

**File: `src/ipc/handlers/template_handlers.ts`**

- Add handlers for the 4 new contracts (list, create, update, delete)
- On delete: reset `selectedTemplateId` to default if the deleted template was selected
- Follow pattern from `prompt_handlers.ts`

---

## Phase 4: Template Resolution — Support custom template IDs

**File: `src/ipc/utils/template_utils.ts`**

- Add `CUSTOM_TEMPLATE_PREFIX = "custom-template:"` constant and helpers (`isCustomTemplateId`, `getCustomTemplateNumericId`)
- Update `getTemplateOrThrow` to look up custom templates from DB when ID starts with `"custom-template:"`
- Convert DB row to `Template` interface shape so `createFromTemplate.ts` works without changes

---

## Phase 5: React Query — Keys and hooks

**File: `src/lib/queryKeys.ts`**

- Add `customTemplates: { all: ["custom-templates"] as const }`

**New file: `src/hooks/useCustomTemplates.ts`**

- `useCustomTemplates()` — list query
- `useCreateCustomTemplate()` — create mutation
- `useUpdateCustomTemplate()` — update mutation
- `useDeleteCustomTemplate()` — delete mutation
- Follow pattern from `src/hooks/useCustomThemes.ts`

---

## Phase 6: New Library Templates Page

**New file: `src/pages/library-templates.tsx`**

Three sections:

1. **Built-in Templates** — Import `localTemplatesData`, render with `TemplateCard`. Selection sets `selectedTemplateId` in settings. "Create App" opens `CreateAppDialog`.
2. **Integrations** — Render `NeonConnector` under an "Integrations" heading.
3. **My Templates** — Custom templates from DB via `useCustomTemplates()`. "New Template" button. Cards with select/edit/delete. Selection uses `"custom-template:{id}"` format.

**New file: `src/components/CreateCustomTemplateDialog.tsx`**

- Dialog with fields: Name (required), Description (optional), GitHub URL (required), Image URL (optional)
- Follow pattern from `CustomThemeDialog`

**New file: `src/components/EditCustomTemplateDialog.tsx`**

- Edit variant, pre-filled. Follow pattern from `EditThemeDialog`.

---

## Phase 7: Routing

**New file: `src/routes/library-templates.ts`**

- Route at `/library/templates` rendering `LibraryTemplatesPage`

**File: `src/router.ts`**

- Import and add `libraryTemplatesRoute` to route tree (before `libraryRoute` so `/library/templates` matches first)

---

## Phase 8: Sidebar Navigation Updates

**File: `src/components/LibraryList.tsx`**

- Add "Templates" entry at top: `{ id: "templates", label: "Templates", to: "/library/templates", icon: LayoutTemplate }`

**File: `src/components/app-sidebar.tsx`**

- Change Library's default `to` from `/themes` to `/library/templates` (line 52)
- `isLibraryRoute` already matches `/library` prefix — no change needed there

---

## Phase 9: Hub Page — Browse-only community templates

**File: `src/pages/hub.tsx`**

- Remove "Official templates" section entirely
- Remove `BackendSection` (NeonConnector) entirely
- Remove `CreateAppDialog` and template selection state
- Update header: "Community Templates" / "Discover community-contributed templates."
- Show community templates in a browse-only grid (no selection, no "Create App")
- Each card shows: image, title, description, GitHub link (view-only)
- Simplify or replace `TemplateCard` usage — could use a simpler read-only variant, or modify `TemplateCard` to accept a `readOnly` prop

---

## Files Modified (existing)

- `src/db/schema.ts`
- `src/ipc/types/templates.ts`
- `src/ipc/types/index.ts`
- `src/ipc/handlers/template_handlers.ts`
- `src/ipc/utils/template_utils.ts`
- `src/lib/queryKeys.ts`
- `src/router.ts`
- `src/components/LibraryList.tsx`
- `src/components/app-sidebar.tsx`
- `src/pages/hub.tsx`

## Files Created (new)

- `src/hooks/useCustomTemplates.ts`
- `src/pages/library-templates.tsx`
- `src/components/CreateCustomTemplateDialog.tsx`
- `src/components/EditCustomTemplateDialog.tsx`
- `src/routes/library-templates.ts`

---

## Verification

1. Run `npm run db:generate` after schema change
2. Run `npm run ts` to verify types
3. Run `npm run lint` to check lint
4. Run `npm run build` then `PLAYWRIGHT_HTML_OPEN=never npm run e2e` to check existing tests pass
5. Manual verification:
   - Library sidebar shows Templates, Themes, Prompts
   - Clicking Library icon goes to `/library/templates`
   - Built-in templates (React, Next.js, Portal Mini Store) appear in Library
   - Neon connector appears under "Integrations" in Library
   - Can create/edit/delete custom templates in Library
   - Can select any template (built-in or custom) and create an app
   - Hub shows only community templates in browse-only mode
