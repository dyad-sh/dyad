# SHADCN_RADIX_TO_BASE_MIGRATION.md

## Overview

Migrate all shadcn UI components in `src/components/ui/` from Radix UI primitives to Base UI primitives, using the reference implementation in `vite/src/components/ui/` as templates.

**Why:** Radix is deprecated; Base UI is well-maintained.

## Scope

- **Remove:** 16 `@radix-ui/react-*` packages
- **Add:** Single `@base-ui/react` package
- **Update:** ~17 component files in `src/components/ui/`

## Key Migration Patterns

| Radix UI | Base UI |
|----------|---------|
| `@radix-ui/react-dialog` | `@base-ui/react/dialog` |
| `DialogPrimitive.Overlay` | `DialogPrimitive.Backdrop` |
| `DialogPrimitive.Content` | `DialogPrimitive.Popup` |
| `data-[state=open]` | `data-open` |
| `data-[state=checked]` | `data-checked` |
| `asChild` prop | `render={<Component />}` prop |
| Direct Content positioning | `Positioner` + `Popup` wrapper |
| `--radix-*` CSS vars | `--available-height`, `--anchor-width` |

## Migration Phases

### Phase 1: Dependencies & Foundation (3 components)

1. **Update `package.json`**
   - Add: `"@base-ui/react": "^1.1.0"`
   - Remove all `@radix-ui/react-*` packages (do this at the end after all components migrated)

2. **Migrate simple components:**
   - `separator.tsx` - Copy from vite reference
   - `label.tsx` - Replace with native `<label>` (Base UI has no Label primitive)
   - `scroll-area.tsx` - Copy from vite reference

### Phase 2: Form Controls (4 components)

3. **Migrate state-based components:**
   - `checkbox.tsx` - Update imports, change `data-[state=checked]` → `data-checked`
   - `switch.tsx` - Same pattern as checkbox
   - `toggle.tsx` - Update to use `aria-pressed` instead of `data-[state=on]`
   - `toggle-group.tsx` - Depends on toggle, update primitive imports

### Phase 3: Tooltip & Popover (2 components)

4. **Migrate floating components with Positioner pattern:**
   - `tooltip.tsx` - Add Positioner wrapper, update delay props
   - `popover.tsx` - Add Positioner wrapper, Popup component

### Phase 4: Dialog Family (3 components)

5. **Migrate overlay components:**
   - `dialog.tsx` - Overlay→Backdrop, Content→Popup, asChild→render
   - `sheet.tsx` - Same changes (uses Dialog primitive)
   - `alert-dialog.tsx` - Same changes + Action/Cancel render props

### Phase 5: Navigation Components (2 components)

6. **Migrate navigation:**
   - `accordion.tsx` - Content→Panel, update state attributes
   - `tabs.tsx` - Content→Panel, Trigger→Tab

### Phase 6: Menu Components (2 components)

7. **Migrate complex menus:**
   - `dropdown-menu.tsx` - Use Menu primitive, add Positioner, update submenu names
   - `select.tsx` - Add Positioner, Viewport→List, ScrollButton→ScrollArrow

### Phase 7: Composite Components (3 components)

8. **Migrate dependent components:**
   - `button.tsx` - Replace `@radix-ui/react-slot` with Base UI equivalent or native approach
   - `sidebar.tsx` - Update Slot usage, verify Tooltip integration
   - `command.tsx` - Update internal Dialog usage (if using shadcn dialog)

### Phase 8: Cleanup

9. **Remove Radix dependencies from `package.json`**
10. **Run `npm install`**
11. **Search for any remaining `@radix-ui` imports**

## Files to Modify

### Component Files (`src/components/ui/`)
- `accordion.tsx`
- `alert-dialog.tsx`
- `button.tsx`
- `checkbox.tsx`
- `dialog.tsx`
- `dropdown-menu.tsx`
- `label.tsx`
- `popover.tsx`
- `scroll-area.tsx`
- `select.tsx`
- `separator.tsx`
- `sheet.tsx`
- `sidebar.tsx`
- `switch.tsx`
- `tabs.tsx`
- `toggle.tsx`
- `toggle-group.tsx`
- `tooltip.tsx`

### Configuration Files
- `package.json` - Update dependencies

### Potential CSS/Tailwind Updates
- Any files using `data-[state=*]` selectors need updating to `data-*` selectors
- CSS variable references: `--radix-*` → Base UI equivalents

## Reference Templates

Use `vite/src/components/ui/` as templates. For each component:
1. Compare vite version with current src version
2. Copy Base UI import pattern and component structure
3. Preserve any project-specific customizations (e.g., `MiniSelectTrigger` in select.tsx)
4. Update Tailwind classes for new data attributes

## API Breaking Changes to Handle

1. **`asChild` → `render` prop** - Components using `asChild` pattern need updates:
   ```tsx
   // Before
   <DialogClose asChild><Button>Close</Button></DialogClose>

   // After
   <DialogClose render={<Button />}>Close</DialogClose>
   ```

2. **Consumers to search for:**
   - `asChild` usage in app code
   - Direct Radix imports elsewhere in codebase

## Verification Plan

After each phase:
1. **Type check:** `npm run ts`
2. **Lint:** `npm run lint`
3. **Build:** `npm run build`
4. **E2E tests:** `PLAYWRIGHT_HTML_OPEN=never npm run e2e`

### Manual Testing Checklist
- [ ] Dialogs open/close with animation
- [ ] Escape key dismisses overlays
- [ ] Click outside dismisses overlays
- [ ] Dropdown menus position correctly
- [ ] Select components work with keyboard
- [ ] Sidebar collapse/expand works
- [ ] Tooltips appear on hover with correct delay
- [ ] Focus management works in modals
- [ ] Accordion expand/collapse animates

## Rollback Strategy

- Keep all changes in a single branch
- Radix and Base UI can coexist temporarily if needed for incremental migration
- Git revert available if major issues discovered
