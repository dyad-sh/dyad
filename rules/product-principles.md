# Product Design Principles

These principles guide feature design decisions in Coney. Reference them when planning new features (especially via `coney:swarm-to-plan`) to ensure consistency with the product's values.

## 1. Backend-Flexible

Users should be able to swap out underlying providers and backends without being locked in.

- **LLM providers**: Users bring their own API keys for OpenAI, Anthropic, Google, Ollama, etc. Features must not assume a specific provider. Example: the chat system uses the Vercel AI SDK abstraction, not provider-specific APIs.
- **Database backends**: Supabase (cloud and local), Neon, and custom Postgres are all supported. The IPC handler layer routes by configuration, so the same UI flow works regardless of backend. Example: `executeSupabaseSql` dispatches to either the Management API or local Postgres based on `supabaseMode`.
- **Deployment targets**: Vercel today, but the architecture shouldn't preclude other platforms. Deployment-specific logic lives behind clear interfaces.

**Test**: If removing a single third-party service would break the core product, the design is too coupled.

## 2. Productionizable

Users build apps from prototype to production in Coney. Every feature should support that full lifecycle, not just the demo.

- **Real deployment**: Apps deploy to Vercel with production environment variables, custom domains, and proper build pipelines — not just local preview.
- **Database migrations**: Drizzle ORM generates versioned migration files that users can track, review, and apply in production. The AI agent writes real migration SQL, not throwaway DDL.
- **Environment separation**: Local Supabase for development, cloud Supabase for production. Mode switching is per-app with explicit confirmation and client code regeneration.
- **Code ownership**: Generated code uses standard frameworks (React, Next.js, Vite) and lives in the user's git repo. No proprietary runtime or Coney-specific dependencies in the output.

**Test**: Could a user hand off the generated project to a team that doesn't use Coney and have them maintain it? If not, the feature creates unacceptable lock-in.

## 3. Intuitive But Power-User Friendly

Make the common path effortless. Give advanced users escape hatches.

- **Templates vs. blank canvas**: The home page offers inspiration prompts and starter templates, but users can also start from scratch or import existing projects.
- **Settings search**: Settings are organized in logical sections, but also fully searchable so power users can jump directly to what they need.

**Test**: Can a first-time user accomplish something useful in under 2 minutes? Can a power user customize every aspect of that same workflow?

## 4. Transparent Over Magical

Show users what's happening. Let them approve consequential actions. No hidden side effects.

- **Code visibility**: The AI shows every file it writes or modifies. Users see diffs, not just results. The streaming response reveals the AI's reasoning in real time.
- **Approval gates**: The agent tool consent system lets users choose ask/always/never per tool. Destructive operations (like dropping a database table) require explicit confirmation.
- **Error surfacing**: Build errors, runtime errors, and terminal output are streamed directly to the user, not swallowed.

**Test**: If a user asks "what did the AI just do?", can they find the answer without reading source code?

## 5. Bridge, Don't Replace

Coney integrates with the tools developers already use. It doesn't try to own their toolchain.

- **Package managers**: Coney runs `npm install` and custom install commands but doesn't manage node_modules or lock files beyond what the user configures.
- **External services**: Supabase CLI, Docker — Coney detects and uses these tools but doesn't install, start, or stop them. Example: local Supabase support detects `supabase status` but the user runs `supabase start` themselves.
- **IDEs**: Generated code is standard — users can open it in VS Code, Cursor, or any editor alongside Coney.

**Test**: Does the feature work _with_ the user's existing tools, or does it try to _replace_ them? If the answer is replace, reconsider.

## 6. Delightful

Using Coney should feel good and like it's crafted with care. Small details compound into an experience people love.

- **Personality in waiting**: The streaming loading animation cycles through playful verbs ("pondering", "conjuring", "weaving") with a scramble-reveal effect, turning a mundane wait into a moment of character.
- **Micro-interactions**: Accordions animate with spring easing, chevrons rotate smoothly, and copy-to-clipboard buttons swap to a green checkmark for 2 seconds before reverting — every interaction gives clear, satisfying feedback.
- **Visual polish**: Error toasts use backdrop blur, gradient icon backgrounds, and rounded corners with shadow. They feel intentional, not afterthought. Monospace error text in a contained box respects the user's need to actually read and copy the message.
- **Live preview**: Changes appear in real time as the AI writes code. The feedback loop between "ask" and "see" is immediate and visceral — it's the core of what makes Coney feel alive.

**Test**: After using this feature, does it feel like someone cared about the details? If the interaction feels generic or utilitarian, look for opportunities to add warmth.
