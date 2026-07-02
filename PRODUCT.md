# Product

## Register

product

## Users

Non-technical builders: people with an app idea but no coding background, often coming from Lovable/v0/Bolt-style tools. They run Dyad locally on Mac or Windows and are frequently in their first hour of the product. They have never used a terminal, don't know what Node.js is, and interpret unexplained technical states as "it's broken." Secondary audience: semi-technical tinkerers who bring their own API keys and local models.

## Product Purpose

Dyad is a local, open-source AI app builder. Users describe an app in plain language; Dyad's AI generates the code and runs a live preview on their machine. Success = a first-time user goes from typed idea to seeing their working app preview with as few decisions, detours, and moments of doubt as possible. Local-first (fast, private, no lock-in) is the core differentiator; Dyad Pro is the monetization path but must never make the free/BYOK path feel second-class.

## Brand Personality

Calm and capable. Quiet confidence in the vein of Linear or Things: the UI gets out of the way, explains exactly what's happening in plain language, and reassures without cheerleading. Progress is acknowledged with restraint, not confetti. Technical necessities (Node.js, API keys, local servers) are framed as brief, guided steps toward the user's app — never as system errors or developer chores.

## Anti-references

- **Enterprise SaaS clutter**: stacked banners, persistent upsell chrome, dashboard-cliché card grids.
- **Toy-like / gimmicky**: mascots, confetti, over-animated "delight" that undermines trust in a tool holding your project.
- **Dev-tool austere**: raw terminal aesthetics, walls of monospace, intimidating error dumps shown to non-developers.
- **Generic AI-startup gloss**: gradient text, decorative glassmorphism, purple-glow hero clichés.

## Design Principles

1. **Never a dead end.** Every state — loading, empty, missing dependency, failure — names what's happening and offers exactly one obvious next action. Silent no-ops are bugs.
2. **Protect the moment of intent.** The user's idea (their prompt, their app) is the center of gravity; setup and system chores orbit it and resume it, never discard it.
3. **Translate, don't expose.** Technical machinery (Node, PATH, providers, ports) is translated into user-goal language ("so Dyad can run your app's preview"), with detail available but never leading.
4. **Calm confidence over persuasion.** One primary action per surface; upsells earn their place contextually and quietly.
5. **Motion explains, chrome doesn't.** Use small, purposeful motion to show progress and state change; avoid decorative chrome that competes with the user's app.

## Accessibility & Inclusion

- Target WCAG 2.1 AA: body text ≥4.5:1 contrast in both light and dark themes.
- Full keyboard operability for all setup/onboarding flows (they're modal-heavy).
- `prefers-reduced-motion` alternatives for every animation.
- UI strings localized via i18n (en, pt-BR, zh-CN today); avoid idioms that translate poorly.
