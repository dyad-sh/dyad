# UI Styling Patterns

## Brand / provider icons

When adding a brand mark for an AI provider (or any well-known SaaS brand), prefer official SVGs over hand-drawn or monogram fallbacks — users expect to see the real logo.

- AI providers (Claude, OpenAI, Gemini, Kimi/Moonshot, Z.ai, DeepSeek, Qwen, MiniMax, Bedrock, Azure, OpenRouter, Grok, Ollama, LM Studio, etc.):
  - `https://unpkg.com/@lobehub/icons-static-svg/icons/<name>.svg`
  - Many also have a `<name>-color.svg` variant with full-color brand gradients (e.g. `gemini-color.svg`, `qwen-color.svg`, `minimax-color.svg`).
- Generic SaaS brands: `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/<name>.svg`.

Embed as inline React SVG components (see `src/components/ProviderIcon.tsx` for the pattern). For SVGs with `<linearGradient>` defs, hard-coded gradient IDs are fine — browsers resolve `url(#id)` to the first definition encountered, and multiple instances of the same icon use the same gradient definition, so there's no need to generate per-instance unique IDs.

## Scrollable popovers and dropdowns

Use the global `.scrollbar-on-hover` class (defined in `src/styles/globals.css`) for thin, hover-only scrollbars in dropdowns, submenus, and popovers. The OS default scrollbar (12px chrome) looks chunky inside small popups — `.scrollbar-on-hover` collapses to a transparent track and only reveals a thin thumb on hover/focus.

```tsx
<DropdownMenuSubContent className="w-64 max-h-100 overflow-y-auto scrollbar-on-hover">
  ...
</DropdownMenuSubContent>
```

## Preview toolbar actions

Use `MoreHorizontal` for compact preview-mode overflow and `MoreVertical` for
the right-most preview utility/actions menu. This keeps two ellipsis controls in
the same preview header visually distinct.

## Tailwind v4 conventions

The project uses **Tailwind v4** (see `tailwindcss: ^4.x` in `package.json`). A few v4-specific affordances that don't work in v3:

- **Arbitrary opacity values:** `bg-primary/8`, `text-muted-foreground/85` — any integer 0–100 works, not just the v3-canonical steps.
- **Arbitrary widths/sizes:** `w-[17rem]`, `size-[3px]` — use these for fine-grained tweaks instead of inventing config values.
- **`size-*` shorthand** sets both `width` and `height`.
