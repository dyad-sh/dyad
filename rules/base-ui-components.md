# Base UI Component Patterns

## Always Use Base UI, Never Radix UI

This project uses **Base UI** (`@base-ui/react`) for all headless UI primitives. **Do not use Radix UI** (`@radix-ui/*`) for any new components. This ensures:

- Consistent animation/transition behavior across all menus and popups
- Uniform keyboard navigation and focus management patterns
- Consistent ARIA attribute usage for accessibility
- A single set of APIs to learn and maintain

If you need a component not yet wrapped in `src/components/ui/`, build it using Base UI primitives following the existing patterns in that directory.

### Context Menu

The `ContextMenu` in `src/components/ui/context-menu.tsx` uses Base UI's native `ContextMenu` primitive (`@base-ui/react/context-menu`), which handles right-click and long-press detection automatically. Key differences from Radix's API:

- Use `onClick` instead of `onSelect` on `ContextMenuItem`
- `ContextMenuTrigger` renders a `<div>` wrapper — no `asChild` needed (use the `render` prop if you need to change the element type)
- Menu positioning at the cursor is handled natively by Base UI

```tsx
// Correct usage
<ContextMenu>
  <ContextMenuTrigger>
    <div>Right-click me</div>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={() => doSomething()}>Action</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

## TooltipTrigger render prop

`TooltipTrigger` from `@base-ui/react/tooltip` (wrapped in `src/components/ui/tooltip.tsx`) renders a `<button>` by default. Wrapping another button-like element (`<button>`, `<Button>`, `<DropdownMenuTrigger>`, `<PopoverTrigger>`, `<MiniSelectTrigger>`, `<ToggleGroupItem>`) inside it creates invalid nested `<button>` HTML. Use the `render` prop instead:

```tsx
// Wrong: nested buttons
<TooltipTrigger><Button onClick={fn}>Click</Button></TooltipTrigger>

// Correct: render prop merges into a single element
<TooltipTrigger render={<Button onClick={fn} />}>Click</TooltipTrigger>
```

- Wrapping `ToggleGroupItem` in `TooltipTrigger` without `render` also breaks `:first-child`/`:last-child` CSS selectors for rounded corners on the group.
- For drag handles and resize rails, prefer the native `title` attribute over `Tooltip` — tooltips appear immediately on hover and interfere with drag interactions, while `title` has a built-in delay.

## Accordion (Base UI vs Radix/shadcn)

The `Accordion` component in `src/components/ui/accordion.tsx` wraps `@base-ui/react/accordion`, **not** Radix or shadcn. The APIs differ:

- **No `type` or `collapsible` props** — these are Radix/shadcn-only. Reviewers may suggest `type="single" collapsible` but these props don't exist on Base UI's Accordion.
- Use `multiple` (boolean, default `false`) to allow multiple items open at once.
- Use `defaultValue` (array of item values) to control which items start expanded.
- Items are collapsible by default — no extra prop needed.
