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

## Flex containers with non-shrinkable children

Don't put an explicit `min-w-*` on a flex item whose children are `flex-shrink-0` (icon buttons, etc.) if that value is smaller than the children's combined width. An explicit `min-width` overrides flexbox's content-based minimum, so the item gets squeezed below its content and the overflow paints over sibling elements — visually broken and it intercepts their pointer events (this broke the preview Restart button at narrow widths). Use `min-w-fit` to let the item refuse to shrink below its content.

## Tailwind v4 conventions

The project uses **Tailwind v4** (see `tailwindcss: ^4.x` in `package.json`). A few v4-specific affordances that don't work in v3:

- **Arbitrary opacity values:** `bg-primary/8`, `text-muted-foreground/85` — any integer 0–100 works, not just the v3-canonical steps.
- **Arbitrary widths/sizes:** `w-[17rem]`, `size-[3px]` — use these for fine-grained tweaks instead of inventing config values.
- **`size-*` shorthand** sets both `width` and `height`.

## Setup affordances that become manage affordances

When reusing a setup component behind a persistent "Manage setup" entry point, make sure the component can render even after setup is complete. Components like setup banners often self-hide once `isAnyProviderSetup()` is true; add an explicit force/manage mode and a regression test that clicks the manage affordance and verifies dialog content appears.

## Visually verifying component designs without launching Electron

To screenshot a redesigned component without driving the full Electron app (which may require onboarding/app state to reach the surface): build a standalone HTML harness using `@tailwindcss/browser@4` (CDN) with the app's CSS variables copied from `src/styles/globals.css` (including the `.dark` block for dark-mode frames), then screenshot it with the repo's Playwright. Note: import Playwright by absolute path — `import { chromium } from "file:///<repo>/node_modules/playwright/index.mjs"` — because plain `import "playwright"` fails with `ERR_MODULE_NOT_FOUND` when the script lives outside the repo (ESM resolves from the script's location, not cwd).

Related: `npm run start:onboarding` launches the real app with fresh userData and `DYAD_DEV_NODEJS_STATUS=missing` to reproduce first-run / Node-missing states.
