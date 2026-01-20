export interface Theme {
  id: string;
  name: string;
  description: string;
  icon: string;
  prompt: string;
}

export const DEFAULT_THEME_ID = "default";

const DEFAULT_THEME_PROMPT = `
<theme>
Any instruction in this theme should override other instructions if there's a contradiction.
### Default Theme
<rules>
All the rules are critical and must be strictly followed, otherwise it's a failure state.
#### Core Principles
- This is the default theme used by Dyad users, so it is important to create websites that leave a good impression.
- AESTHETICS ARE VERY IMPORTANT. All web apps should LOOK AMAZING and have GREAT FUNCTIONALITY!
- You are expected to deliver interfaces that balance creativity and functionality.
#### Component Guidelines
- Never ship default shadcn components — every component must be customized in style, spacing, and behavior.
- Always prefer rounded shapes.
#### Typography
- Type should actively shape the interface's character, not fade into neutrality.
#### Color System
- Establish a clear and confident color system.
- Centralize colors through variables to maintain consistency.
- Avoid using gradient backgrounds.
- Avoid using black as the primary color. Aim for colorful websites.
#### Motion & Interaction
- Apply motion with restraint and purpose.
- A small number of carefully composed sequences (like a coordinated entrance with delayed elements) creates more impact than numerous minor effects.
- Motion should clarify structure and intent, not act as decoration.
#### Visual Content
- Visuals are essential: Use images to create mood, context, and appeal.
- Don't build text-only walls.
#### Contrast Guidelines
Never use closely matched colors for an element's background and its foreground content. Insufficient contrast reduces readability and degrades the overall user experience.
**Bad Examples:**
- Light gray text (#B0B0B0) on a white background (#FFFFFF)
- Dark blue text (#1A1A4E) on a black background (#000000)
- Pale yellow button (#FFF9C4) with white text (#FFFFFF)
**Good Examples:**
- Dark charcoal text (#333333) on a white or light gray background
- White or light cream text (#FFFDF5) on a deep navy or dark background (#1A1A2E)
- Vibrant accent button (#6366F1) with white text for clear call-to-action visibility
### Layout structure
- ALWAYS design mobile-first, then enhance for larger screens.
</rules>
<workflow>
Follow this workflow when building web apps:
1. **Determine Design Direction**
   - Analyze the industry and target users of the website.
   - Define colors, fonts, mood, and visual style.
   - Ensure the design direction does NOT contradict the rules defined for this theme.
2. **Build the Application**
   - Do not neglect functionality in the pursuit of making a beautiful website.
   - You must achieve both great aesthetics AND great functionality.
</workflow>
</theme>`;

const APPLE_THEME_PROMPT = `
<theme>
Any instruction in this theme should override other instructions if there's a contradiction.

## Objective
Your goal is to recreate the "Cupertino" aesthetic (iOS/macOS) via a semantic, token-based design system.

> **The "Uncanny Valley" Warning:** Generic web design looks like "Bootstrap" or "Material". Apple design looks like "Glass", "Paper", and "Physics". If the result looks like a standard dashboard, you have failed.

---

## SECTION 1 — The Semantic Theme (The Source of Truth)

**CRITICAL INSTRUCTION:** Do not use arbitrary hardcoded values (e.g., \`h-[44px]\`, \`bg-[#F2F2F7]\`, \`rounded-2xl\`) in your JSX. You MUST use Tailwind arbitrary values referencing the following semantic CSS variables (e.g., \`bg-[--ios-bg]\`, \`rounded-[--radius-card]\`, \`text-[--ios-text]\`).

### CSS Variable Definition (Assume globally active)

You must build your components assuming this CSS exists in the environment:

\`\`\`css
:root {
  /* COLORS: System Gray & Blue */
  --ios-bg: #F2F2F7;         /* The signature Apple background */
  --ios-surface: #FFFFFF;    /* Pure white cards */
  --ios-primary: #007AFF;    /* Apple Blue */
  --ios-text: #000000;       /* Primary Text */
  --ios-text-sec: #8E8E93;   /* Secondary Text (Gray) */
  --ios-border: rgba(0, 0, 0, 0.08); /* Hairline border */
  --ios-glass: rgba(255, 255, 255, 0.8); /* Frosted glass */

  /* DIMENSIONS: Radii & Spacing */
  --radius-card: 20px;       /* Large smooth curves */
  --radius-input: 12px;      /* Input fields */
  --radius-pill: 9999px;     /* Buttons */
}

@media (prefers-color-scheme: dark) {
  :root {
    --ios-bg: #000000;
    --ios-surface: #1C1C1E;
    --ios-primary: #0A84FF;
    --ios-text: #FFFFFF;
    --ios-text-sec: #98989F;
    --ios-border: rgba(255, 255, 255, 0.12);
    --ios-glass: rgba(30, 30, 30, 0.7);
  }
}
\`\`\`

---

## SECTION 2 — The "Apple Look" DNA (Hard Rules)

### 1. The Layered Background Logic
- **Root Container/Wrapper:** NEVER use \`bg-white\`. The outermost wrapper of your component structure must use \`bg-[--ios-bg]\` (and usually \`min-h-screen\` if it's a page view).
- **Cards/Surfaces:** Use \`bg-[--ios-surface]\`. This creates the essential separation from the background.
- **Dark Mode:** Rely strictly on the CSS variables defined above; do not manually toggle dark classes for colors.

### 2. Typography & "Tight-Heading" Logic
- **Font Family:** Assume \`-apple-system, BlinkMacSystemFont, sans-serif\` is set globally.
- **Headings:** Apple headers are TIGHT. Apply \`tracking-tight\` or \`tracking-tighter\` to ALL text larger than 20px (e.g., \`text-xl\` and up).
- **Weight Hierarchy:**
  - Headers: \`font-semibold\`.
  - Body: \`font-normal\`.
  - Buttons: \`font-medium\`.

### 3. The "Hairline" Border Rule
- Standard 1px borders look "cheap" and thick.
- **Rule:** Use \`border-[0.5px]\` or \`border\` combined with the semantic color.
- **Color:** ALWAYS use \`border-[--ios-border]\`.
- **Result:** A subtle, barely-there separation.

### 4. Corner Smoothing (The "Squircle")
- **Cards:** \`rounded-[--radius-card]\` (20px).
- **Buttons:** \`rounded-[--radius-pill]\` (Full Pill).
- **Inputs:** \`rounded-[--radius-input]\` (12px).

### 5. Depth = Blur + Shadow
- **Glass:** Navbars, Modals, and Floating elements MUST use:
  - \`bg-[--ios-glass]\`
  - \`backdrop-blur-xl\`
  - \`border-b border-[--ios-border]\` (if a navbar) or full border.
- **Shadows:** Shadows must be extremely subtle and diffuse, using low opacity (e.g., \`shadow-black/5\`) to mimic ambient occlusion rather than direct harsh lighting. Reserve drop shadows strictly for "floating" elements (modals, sticky headers, popovers) to indicate Z-axis elevation; never apply them to flat content cards which rely on background color contrast for separation. When using shadows, prefer larger blur radii (\`shadow-xl\` or \`shadow-2xl\`) over distinct offsets to maintain the soft, "air-gapped" physical feel of iOS surfaces.

---

## SECTION 3 — Component Blueprints (Pattern Matching)

### 3.1 The "Cupertino Button"
- **Shape:** \`rounded-[--radius-pill]\`.
- **Height:** \`h-10\` or \`h-12\` (Do not use arbitrary pixel heights).
- **Primary:** \`bg-[--ios-primary]\` with \`text-white\`.
- **Secondary:** \`bg-[--ios-surface]\` with \`text-[--ios-text]\` and \`border border-[--ios-border]\`.
- **Animation:** \`active:scale-95 transition-transform duration-200\`.

### 3.2 The "Grouped Inset" List (Settings Style)
- **Container:** \`max-w-2xl mx-auto p-4\`.
- **Card wrapper:** \`bg-[--ios-surface] rounded-[--radius-card] overflow-hidden\`.
- **Item:** \`p-4 flex items-center justify-between border-b border-[--ios-border] last:border-0\`.
- **Text:** Left aligned, \`text-[17px]\`.

### 3.3 The "Search Bar"
- **Background:** \`bg-[--ios-border]\` (Using the border color as a fill creates that dim gray input look).
- **Placeholder:** \`text-[--ios-text-sec]\`.
- **Radius:** \`rounded-[--radius-input]\`.
- **Height:** \`h-9\` (Compact).

---

## SECTION 4 — Self-Correction Checklist

Before outputting JSX code, ask:

1. Did I use \`class\` instead of \`className\`? -> **WRONG.** Use JSX syntax.
2. Did I use a hardcoded hex code? -> **WRONG.** Use \`var(--ios-...)\` via arbitrary tailwind values.
3. Did I use standard tailwind radii like \`rounded-2xl\`? -> **WRONG.** Use \`rounded-[--radius-card]\` to enforce consistency.
4. Is the root background white? -> **WRONG.** Change to \`bg-[--ios-bg]\`.
5. Is the header font tracking normal? -> **WRONG.** Change to \`tracking-tight\`.

</theme>`;

export const themesData: Theme[] = [
  {
    id: "default",
    name: "Default Theme",
    description:
      "Balanced design system emphasizing aesthetics, contrast, and functionality.",
    icon: "palette",
    prompt: DEFAULT_THEME_PROMPT,
  },
  {
    id: "apple",
    name: "Apple Theme",
    description:
      "Cupertino aesthetic (iOS/macOS) with glass, blur, and semantic design tokens.",
    icon: "apple",
    prompt: APPLE_THEME_PROMPT,
  },
];

export function getThemeById(themeId: string | null): Theme | null {
  // null means "no theme" - return null
  if (!themeId) {
    return null;
  }
  return themesData.find((t) => t.id === themeId) ?? null;
}

export function getThemePrompt(themeId: string | null): string {
  // null means "no theme" - return empty string (no prompt)
  if (!themeId) {
    return "";
  }
  const theme = getThemeById(themeId);
  return theme?.prompt ?? "";
}
