# Base UI Component Patterns

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
