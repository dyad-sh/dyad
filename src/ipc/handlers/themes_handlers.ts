import { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { db } from "@/db";
import { themes } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  CreateThemeParamsDto,
  ThemeDto,
  UpdateThemeParamsDto,
} from "../ipc_types";

const logger = log.scope("themes_handlers");
const handle = createLoggedHandler(logger);

// Helper to map DB row to DTO
function mapRowToDto(row: typeof themes.$inferSelect): ThemeDto {
  return {
    id: row.id!,
    title: row.title,
    description: row.description ?? null,
    prompt: row.prompt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Embedded theme prompts
const DEFAULT_THEME_PROMPT = ` 
<theme> 
Any instruction in this theme should override other instructions if there's a contradiction
### Default Theme:
- This is the default theme used by Dyad users , so it is important to create websites that leave a good impression.
- Remember! AESTHETICS ARE VERY IMPORTANT. All web apps should LOOK AMAZING and have GREAT FUNCTIONALITY!
- Your are expected to deliver interfaces that balance creativity and functionality. 
- Never ship default shadcn components - Every component must be customized in style, spacing, and behavior
- You prefer making rounded shapes unless there's a reason not to .
- Do not rely on default or commonly reused font families (such as Arial, Inter, Roboto, or system fonts). Type should actively shape the interface’s character, not fade into neutrality.
- Establish a clear and confident color system. Centralize colors through variables to maintain consistency.
- Apply motion with restraint and purpose.
  **Principle:**
  - A small number of carefully composed sequences (like a coordinated entrance with delayed elements) creates more impact than numerous minor effects
  - Motion should clarify structure and intent, not act as decoration
- Visuals are essential: Use images to create mood, context, and appeal. Don't build text-only walls.
- Avoid using gradient backgrounds 
</theme>`;

const APPLE_HIG_THEME_PROMPT = `# <theme>
Any instruction in this theme should override other instructions if there's a contradiction
You frequently settle into low-risk, median outputs. In frontend design, this manifests as visually bland, AI-identifiable interfaces. **This is a failure state.**
You are expected to deliver interfaces that feel **intentional, expressive, and uniquely designed**. Every result should feel context-specific and crafted, not default or synthetic.
**Aesthetics are critical.** All applications must look premium, intentional, and production-ready.
Always start by configuring globals.css and tailwind.config.ts
Apple Human Interface (Cupertino):

You are building a web application that follows the Apple Human Interface Guidelines (HIG), specifically the **Cupertino (iOS)** design language.
Implemented with React, Tailwind CSS, and shadcn/ui.

### Key Requirements

- **Never ship default shadcn components** - Components must be adapted to fit the iOS aesthetic (highly rounded, translucent, smooth motion).
- **Web Adaptation** - Apply iOS principles (Grouped Inset views, Large Titles) to the web context.
- **Translucency is Mandatory** - Navbars and overlays must use backdrop blurs.

**CRITICAL INSTRUCTION:** You must **NEVER** use arbitrary values in Tailwind classes (e.g., \`h-[50px]\`, \`tracking-[-0.01em]\`, \`rounded-[14px]\`). You must **ONLY** use the utility tokens defined in the \`tailwind.config.ts\` below.
**CRITICAL INSTRUCTION:** You must follow all the rules and examples mentioned bellow , otherwise it's a failure state .
## SECTION 0 — General Design Principles

*These principles apply to all platforms and override stylistic preferences.*

### 1. Clarity First
- Ensure purpose, structure, and available actions are immediately clear
- Prefer explicit labels and cues over implied meaning
- Avoid ambiguous icons, unlabeled controls, or hidden primary actions

### 2. Visual Hierarchy
- Establish hierarchy using size, spacing, contrast, and position
- Emphasize the single most important content or action per screen
- Avoid giving equal visual weight to unrelated or unequal elements

### 3. Spacing & Grouping (The "Grouped Inset" Rule)
- Space elements according to their relationship
- Use spacing as the primary grouping mechanism before containers
- Use a consistent, proportional spacing scale
- Avoid arbitrary or pixel-by-pixel spacing decisions

### 4. Alignment & Layout Discipline
- Use as few alignment types as possible within a screen
- Maintain consistent alignment across similar components
- Align related elements along a shared axis
- Avoid mixing left, center, and right alignment within the same group

### 5. Contrast & Accessibility
- Ensure all UI elements meet WCAG AA contrast requirements
- Never rely on color alone to convey meaning or state
- Avoid subtle contrast differences that reduce recognizability

### 6. Color Usage
- Use color to reinforce hierarchy and interaction state
- Apply color consistently across similar elements
- Always pair color with secondary cues (text, icon, shape)

### 7. Typography Discipline
- Use a limited, consistent typography scale
- Optimize readability across all text sizes
- Adjust letter spacing when required for clarity
- Avoid unnecessary decorative typography

### 8. Action Hierarchy
- Use a single primary action per screen when possible
- Clearly differentiate primary, secondary, and tertiary actions
- Avoid placing multiple primary actions in the same context

### 9. Affordance & Interactivity
- Make interactive elements visually distinct from static content
- Provide clear hover, focus, pressed, and disabled states
- Avoid removing affordances purely for visual minimalism

### 10. Interaction Safety
- Ensure interactive elements meet platform accessibility target-size guidelines
- Separate interactive targets sufficiently to prevent mis-input
- Never prioritize compactness over usability

### 11. Visibility of Important Content
- Keep critical content and actions visible by default
- Surface frequently used actions prominently
- Avoid hiding essential actions behind menus unnecessarily

### 12. Structural Simplicity
- Use containers only when they add clarity
- Prefer spacing, alignment, and similarity before borders or cards
- Avoid overusing containers that introduce visual noise

### 13. Consistency & Predictability
- Ensure similar elements look and behave consistently across the interface
- Maintain a unified visual and interaction language
- Avoid one-off styles or behaviors

### 14. Purposeful Minimalism
- Remove only elements that do not contribute to clarity or usability
- Ensure necessary context and labels remain visible
- Avoid reducing UI to the point of ambiguity

### 15. Icon & Text Balance
- Balance visual weight between icons and text
- Icons represent meaning, not decoration
- Icon size must never be used to imply importance

### 16. Feedback & System Response
- Provide immediate feedback for user actions
- Clearly communicate loading, success, error, and disabled states
- Never leave users uncertain about system status

### 17. Modern UI Baseline (Mandatory)
- Favor generous whitespace
- Maintain a clean, readable hierarchy
- Use subtle, purposeful motion only to communicate state
- Design mobile-first, then scale up
- Use contemporary, highly readable fonts
- Avoid decorative bloat, outdated patterns, or visual noise

### 18. Sizing Consistency (Critical)
- Interactive element sizes must be explicitly defined
- Size must not be determined by text length, icon size, or mixed content
- Elements with the same purpose must have identical dimensions

## SECTION 1 — Hard Rules (Global Constraints) (MANDATORY)

### 1. Layout & Spacing (Grouped Inset Style)

- **Density:** Interfaces must breathe. Avoid dense packing
- **Alignment:** STRICT alignment on the shared vertical axis. Text inside containers must align perfectly with headers
- **Containers:** Use grouping and spacing rather than visible containers where possible
- **Max Width:** Content is centered with a max-width of \`1200px\` (or \`screen-xl\`)

### 2. Elevation, Materials & Depth (The "Glass" Physics)

**Shadows:** **STRICTLY BANNED.** Do not use drop shadows to define depth.

**Depth Strategy:** Depth is achieved exclusively through:
1. **Translucency:** \`backdrop-blur-2xl\` + \`bg-background/80\` (for Navbars, Modals, Floating Actions)
2. **Hairlines:** Strict usage of \`border-hairline\` (0.5px)
3. **Separation:** Grouped background colors (Secondary/Tertiary)

**Card Metaphor (Reference: Settings App / Apple Wallet):**
- **Strict Rule:** Content cards must be **Pure White** (\`bg-card\` / \`bg-white\`) floating on a **Light Gray** system background (\`bg-secondary\`).
- **FORBIDDEN:** Gray backgrounds on cards.
- **FORBIDDEN:** Colored cards (unless specific wallet-style passes).
- **Structure:** Cards are high-radius (32px or 20px).

**Borders:**
- Use \`border-hairline\` token ONLY
- Colors are handled via \`border-border\` variable (calibrated for 4% opacity black in light mode)

### 3. Typography (San Francisco Style)

**Casing:** Sentence case only. **NEVER** use Uppercase headers.

**Hierarchy & Contrast (Dramatic):**
- **Headings:** Use large, heavy headings (Title 1, Large Title) contrasted with standard body text.
- **Contrast:** Ensure distinct weight/size contrast between headers and content.

**Tracking (Letter Spacing):**
- Headers: Must use \`tracking-ios-head\`
- Body: Must use \`tracking-ios-body\`

**Weight:**
- Default: \`font-normal\` (Regular)
- Emphasis: \`font-medium\` or \`font-semibold\`
- **BANNED:** \`font-black\` or \`font-extra-bold\`

### 4. Icons (SF Symbols Style)

- **Library:** Use \`Lucide React\` or \`Radix Icons\` mapped to SF Symbol aesthetics
- **Sizing:** Icons must be distinct but not dominating
- **Stroke:** Use \`stroke-[1.5px]\` or \`stroke-2\` depending on size
- **Structure (CRITICAL):** Icons must be **standalone glyphs**.
- **BANNED:** Never use colored squares, circles, or rounded containers behind icons (no "app icon" look for features).
- **Correct Usage:** Icons float directly above or next to text, matching the text color or a primary accent color.

### 5. Interaction & Motion

**Touch Targets:** Minimum dimensions are enforced via height tokens (\`h-ios-input\`)

**States:**
- Hover: No elevation change. Slight background darkening or opacity shift
- Active: Scale down using \`active:scale-95\` (or specific \`scale-[0.97]\` token if configured)

**Animation:** Use \`transition-all duration-200 ease-out\`

**Hover State Physics:**
- **Primary Buttons:** May darken slightly (hover:bg-primary/90). Text remains white
- **Secondary Buttons:**
  - Background: Must become slightly off-white (hover:bg-secondary/50)
  - Text Critical: Text must NEVER turn white. It must remain dark (hover:text-foreground)
- **Ghost Buttons:** Background appears only on hover

### 6. Structural Integrity (Anti-Collapse)

**The "Empty State" Ban:** No structural container (Card, Section, Panel) is allowed to rely solely on its content for height.

**Minimum Dimensions:**
- Interactive Elements: Must have explicit height tokens (e.g., h-10, h-12)
- Containers: Must use min-h- classes to prevent total collapse (e.g., min-h-[100px] or min-h-screen)

**Flex Strategy:**
- Never leave a flex child undefined. Always use flex-1 (grow) or flex-none (fixed)
- **BANNED:** width: auto on structural columns. Use fractional widths (w-1/2) or explicit grid columns (grid-cols-3)

**Image/Media Safety:**
- Images must always have an aspect-ratio class applied (e.g., aspect-video, aspect-square) to reserve space before loading

### 7. Layout Safety & Content Protection (Anti-Bug Protocol)

**The "Anti-Stretch" Rule (Buttons vs. Containers):**
- Interactive elements (Buttons, Inputs) must NEVER stretch to fill the height of their parent container
- Mandatory: Flex containers (Navbars, Headers, List Items) must always use items-center to center children vertically
- Mandatory: Buttons must strictly use their defined height token (e.g., h-ios-touch-lg), never h-full

**The "Anti-Squash" Rule (Icons):**
- Fixed-size elements (Icons, Avatars, Badge Containers) inside flex rows must ALWAYS use flex-shrink-0 or flex-none

**The "Cut-off Text" Fix:**
- Never use overflow-hidden on a card containing text unless absolutely necessary for rounded corners
- Always apply bottom padding (pb-6 or pb-safe) to containers to ensure text descenders are not cut off

**The "Footer Collapse" Fix:**
- Never set a fixed height on footers or text blocks (e.g., avoid h-16)
- Use min-h-[value] combined with py-4 so the container expands if text wraps

### 8. Navbar Protocol (Strict Sizing & Materials)

**Navbar vs. Page Protocol:**
- **Translucency (Mandatory):** The Navbar **MUST** use translucent materials: \`bg-background/80\` (or \`bg-white/80\`) + \`backdrop-blur-md\`. Content must scroll behind it.
- **The Navbar Limit:** The Navbar container must have a fixed height of h-16 (64px) with items-center and px-6
- **The "Anti-Giant" Rule:** You must NEVER use h-ios-primary (50px) buttons inside the Navbar
- **Navbar Actions:** Buttons inside the Navbar must use the smaller h-ios-sm token (36px) to look proportional
- **Page Actions:** Primary and Secondary buttons on the page (Hero, Cards) must be tall (h-ios-primary / 50px) and share the same height side-by-side

### 9. Shapes

**Shape Hierarchy:**
- **Buttons (Global):** ALL buttons (Primary, Secondary, Ghost, Navbar) must be Pill-Shaped (\`rounded-full\` or \`9999px\`). No rounded rectangles for buttons.
- **Inputs:** Must remain distinct with \`rounded-ios-input\` (16px) to avoid confusion with buttons.
- **Cards:** Must use \`rounded-ios-card\` (32px or 20px).

---

## SECTION 2 — Design Tokens

*The "No Arbitrary Value" Engine - Use the following configuration files*
It is mandatory to use the following configuration files for the design tokens.

### 2.1 \`globals.css\` (Apple System Colors) (MANDATORY)
\`\`\`css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Apple System Colors - Light Mode Default */
    --background: 0 0% 100%;       /* Pure White */
    --foreground: 240 1% 15%;      /* SF Gray almost black */
    
    /* Layering (Grouped Table Views) */
    --card: 0 0% 100%;
    --card-foreground: 240 1% 15%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 1% 15%;

    /* Apple Palette (Hashed) */
    --primary: 211 100% 50%;       /* System Blue #007AFF */
    --primary-foreground: 0 0% 100%;
    --secondary: 240 5% 96%;       /* System Gray 6 (F2F2F7) - Backgrounds */
    --secondary-foreground: 240 1% 15%;
    --tertiary: 0 0% 98%;          /* Slightly off-white */
    
    /* Muted (Label 2) */
    --muted: 240 5% 96%;
    --muted-foreground: 240 4% 55%; /* System Gray (8E8E93) */
    
    --accent: 211 100% 50%;
    --accent-foreground: 0 0% 100%;
    
    --destructive: 349 100% 60%;   /* System Red */
    --destructive-foreground: 0 0% 100%;

    /* The "Hairline" Color */
    --border: 0 0% 0% / 0.08;      /* Very subtle dark border */
    --input: 0 0% 0% / 0.08;
    --ring: 211 100% 50%;
    
    --radius-ios-btn: 9999px;      /* Full Pill Shape for Buttons */
    --radius-ios-card: 32px;       /* Modern iOS Sheet/Card curvature */
    --radius-ios-input: 16px;      /* Softer Inputs */
  }

  .dark {
    /* Apple System Colors - Dark Mode */
    --background: 0 0% 0%;         /* Pure Black */
    --foreground: 0 0% 100%;
    
    --card: 240 2% 11%;            /* System Gray 6 Dark (1C1C1E) */
    --card-foreground: 0 0% 100%;
    --popover: 240 2% 11%;
    --popover-foreground: 0 0% 100%;
    
    --primary: 211 100% 50%;       /* System Blue Dark #0A84FF */
    --primary-foreground: 0 0% 100%;
    
    --secondary: 240 2% 18%;       /* System Gray 5 Dark (2C2C2E) */
    --secondary-foreground: 0 0% 100%;
    
    --muted: 240 2% 18%;
    --muted-foreground: 240 5% 64%;
    
    --destructive: 349 100% 60%;
    --destructive-foreground: 0 0% 100%;

    --border: 0 0% 100% / 0.12;    /* Subtle white border */
    --input: 0 0% 100% / 0.12;
    --ring: 211 100% 50%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-secondary text-foreground antialiased selection:bg-primary/20;
    /* Force SF font stack */
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }
}

\`\`\`

### 2.2 \`tailwind.config.ts\` (The Extensions) (MANDATORY)

\`\`\`typescript
import { type Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1200px", // Restrict max width to human-readable size
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))", // Maps to the translucent hair values
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      // EXTENSIONS FOR HIG COMPLIANCE
      borderWidth: {
        hairline: "0.5px", // The magic 0.5px border
      },
      borderRadius: {
        "ios-btn": "var(--radius-ios-btn)",     // 14px
        "ios-input": "var(--radius-ios-input)", // 10px
        "ios-card": "var(--radius-ios-card)",   // 20px / 32px
      },
      height: {
        "ios-sm": "36px",       // NEW: Compact token (Navbar/Filters)
        "ios-default": "44px",  // Standard (Inputs)
        "ios-primary": "50px",  // Large (Page CTAs only)
      },
      letterSpacing: {
        "ios-head": "-0.022em", // Tight header tracking
        "ios-body": "-0.011em", // Tight body tracking
      },
      scale: {
        "98": "0.98", // Subtle press effect
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

\`\`\`

---

## SECTION 3 — Component Sizing & Consistency (MANDATORY)

*You must follow these consistency rules using the defined tokens.*

### Navbar Actions (Header Context)

- **Height:** h-ios-sm (36px) — Strictly enforced compact size
- **Radius:** rounded-full (or rounded-ios-btn) — Must be Pill-Shaped
- **Container:** Navbar must be h-16 (64px) with items-center
- **Forbidden:** Do not use 50px buttons here

### Page Actions (Hero, Forms, CTAs)

- **Height:** h-ios-primary (50px) — Applies to Primary AND Secondary
- **Radius:** rounded-full (or rounded-ios-btn) — Must be Pill-Shaped
- **Rule:** When side-by-side, Primary and Secondary buttons must be identical in height and shape

### Inputs (Distinct from Buttons)

- **Height:** h-ios-default (44px)
- **Radius:** rounded-ios-input (16px) — Soft corners, but NOT full pill
- **Background:** bg-secondary with border-transparent

### Cards (Grouped Views)

- **Radius:** rounded-ios-card (32px) — High curvature
- **Border:** border-hairline
- **Safety:** min-h-structure-sm (Anti-collapse)
- **Background:** Pure white (\`bg-card\`) OR Transparent. NO Gray Cards.

---

## SECTION 4 — shadcn/ui Component Examples

### 4.1 The "Cupertino" Button

*Note: Usage of \`h-ios-touch-lg\` and \`tracking-ios-body\`*

\`\`\`tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center font-medium tracking-ios-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-98 ring-offset-background rounded-ios-btn", 
  {
    variants: {
      variant: {
        default: 
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-none border-transparent",
        
        secondary: 
          "bg-white text-foreground border border-hairline hover:bg-secondary/50 hover:text-foreground", // EXPLICIT: Text stays dark
        
        ghost: 
          "hover:bg-secondary/50 text-foreground",
        
        destructive: 
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "h-ios-primary px-8 text-[17px]", // 50px Pill (Page)
        sm: "h-ios-sm px-4 text-sm",                // 36px Pill (Navbar)
        icon: "h-ios-primary w-ios-primary",        // Icon only
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

\`\`\`

### 4.2 The "Cupertino" Card

*Note: No shadow, hairline border only*

\`\`\`tsx
import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-ios-card border border-hairline bg-card text-card-foreground",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

export { Card }

\`\`\`

### 4.3 The "Cupertino" Input

*Note: Uses \`h-ios-touch\` and \`bg-secondary\` for contrast against white cards*

\`\`\`tsx
import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-ios-touch w-full rounded-ios-input bg-secondary px-3 py-2 text-[17px] tracking-ios-body ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

\`\`\`

---

## SECTION 5 — Self-Correction Checklist

**Before generating any code, verify:**

- [ ] **Navbar Check:** Did I put a 50px button in the Navbar? → FAIL. Use h-ios-sm (36px)
- [ ] **Radius Check:** Are buttons/cards highly rounded (Pill/32px)? → PASS
- [ ] **Page Button Check:** Are the "Get Started" and "Learn More" buttons the same height (50px)? → PASS
- [ ] **Arbitrary Check:** Did I use h-[60px]? → FAIL. Use tokens only
- [ ] **Card Check:** Are cards pure white? → PASS
- [ ] **Icon Check:** Are icons standalone (no colored backgrounds)? → PASS
- [ ] **Material Check:** Is navbar translucent? → PASS</theme>`;

const MATERIAL_DESIGN_3_PROMPT = `# <theme>
Any instruction in this theme should override other instructions if there's a contradiction
You frequently settle into low-risk, median outputs. In frontend design, this manifests as visually bland, AI-identifiable interfaces. **This is a failure state.**
You are expected to deliver interfaces that feel **intentional, expressive, and uniquely designed**. Every result should feel context-specific and crafted, not default or synthetic.
**Aesthetics are critical.** All applications must look premium, intentional, and production-ready.

Material Design 3

You are building a web application that follows the Material Design 3 design system, implemented with React, Tailwind CSS, and shadcn/ui.

### Key Requirements

- **Never ship default shadcn components** - Components must be adapted to Material Design 3 by adjusting shape, spacing, surface treatment, and state layers
- **This is a website, not a mobile app** - Apply M3 principles appropriately for the web
- **Standard website layout expected** - Including a navigation bar, unless there is a clear and justified reason to omit it

---

## SECTION 1 — Hard Rules (Non-Negotiable)

### 1. No Arbitrary Values (Critical)

You must not use Tailwind arbitrary values anywhere in component code:

**FORBIDDEN:**
- \`text-[28px]\`, \`rounded-[18px]\`, \`shadow-[…]\`, \`bg-[#…]\`, \`p-[22px]\`

**ONLY ALLOWED:**
- Inside token definitions in \`globals.css\` and \`tailwind.config.ts\`

**USE INSTEAD:**
- Semantic tokens and named utilities: \`text-headline-md\`, \`bg-surface-container-low\`, \`shadow-1\`, \`rounded-md\`, \`h-12\`, \`gap-6\`

### 2. Material Symbols Import (Mandatory)

**Installation:**
Material Symbols must be installed via npm. CDN usage is forbidden.

\`\`\`bash
npm install material-symbols@latest
\`\`\`

**Global Import:**
Import once in the app entry point (\`main.tsx\`, \`index.tsx\`, or \`app/layout.tsx\`):

\`\`\`tsx
import "material-symbols/outlined.css";
\`\`\`

**Usage (Strict):**
Icons must be rendered using Material Symbols only:

\`\`\`tsx
<span className="material-symbols-outlined">search</span>
\`\`\`

**Icon Container Rules:**
Every icon must be wrapped in a fixed container:

\`\`\`tsx
<div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
  <span className="material-symbols-outlined">search</span>
</div>
\`\`\`

**Requirements:**
- Minimum touch target: 48×48
- Always \`flex-shrink-0\`
- No SVGs, no other icon libraries

**Invalid Output:**
- Using Google Fonts CDN
- Missing material-symbols dependency
- Icons without fixed-size containers
- Mixing icon libraries

**Material Symbols — Name Validation (Mandatory):**
- Icon names must be valid Material Symbols glyphs
- Do NOT invent, guess, or camelCase icon names
- Use exact, documented \`snake_case\` names only

### 3. No Overlap / Overflow

- No overlapping elements, no horizontal overflow
- Default to \`gap-4\` or \`gap-6\`
- Use \`min-w-0\` for text containers inside flex rows
- Icons are always \`flex-shrink-0\`

### 4. Typography Accuracy

- Display/Headline (>24px) must be \`font-normal\`
- Titles/Labels use \`font-medium\`
- Sentence case labels everywhere ("Get started", not "GET STARTED")

### 5. M3 Surfaces & Elevation

- Depth is represented by surface containers, not heavy shadows
- Shadows are subtle and tokenized only: \`shadow-1\`, \`shadow-2\`
- Hover/pressed feedback uses state layers (opacity overlays)
- **Never increase shadow/elevation on hover**
- Avoid using elevated elements

### 6. No Border-Defined Components

- Do not use borders/rings/outlines to define components
- Dividers only if structurally needed using outline tokens

### 7. Touch Targets

All interactive controls must be ≥ 48×48:
- Buttons / icon buttons: \`h-12\`, icon buttons \`w-12 h-12\`
- Inputs at least \`h-12\`

### 8. Colors
Material Design 3 must use a seed-based tonal color system.
You are required to select exactly one primary seed color based on the product’s domain and emotional intent.

Mandatory Rules

All colors must be derived from the seed via tonal palettes (primary, secondary, tertiary, neutral, neutral-variant).

Colors must be applied by semantic roles only:
Primary, On-Primary, Primary Container, On-Primary Container,
Surface, Surface Variant, On-Surface, Outline, etc.

Never reference raw hex values directly in components.

Never invent or tweak colors ad hoc.

Never use pure black or pure white except for text contrast tokens when required.

Behavioral Constraints

Monochrome (black/white/gray) UIs are invalid unless explicitly requested by the user.

Every interactive element must use role-based state layers (hover/pressed/focus) instead of new colors.

Light and dark mode must use the same roles with different tones, never different palettes.

Failure Conditions (Output Is Invalid If Any Occur)

Arbitrary hex colors appear in components

Colors are chosen for “aesthetic feel” instead of role correctness

Dark mode uses different hues instead of different tones

Components bypass the MD3 role system
---

## SECTION 2 — Required Token Files (MANDATORY)

Use the following configuration files for the design tokens , just adapt them to match the user's seed color.
If the user didnt provide a seed color, just use the provided colors.
### 2.1 \`globals.css\` (Token Definitions) (MANDATORY)

\`\`\`css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222 20% 12%;

    --surface: 0 0% 100%;
    --surface-container-low: 0 0% 98%;
    --surface-container: 0 0% 96%;
    --surface-container-high: 0 0% 94%;

    --primary: 262 62% 48%;
    --on-primary: 0 0% 100%;
    --primary-container: 262 78% 92%;
    --on-primary-container: 262 40% 18%;

    --secondary-container: 220 30% 90%;
    --on-secondary-container: 220 28% 18%;

    --on-surface: 222 20% 12%;
    --on-surface-variant: 220 10% 35%;

    --outline-variant: 220 14% 80%;
    --scrim: 0 0% 0%;
    --shadow: 220 30% 10%;

    --radius-sm: 0.5rem;
    --radius-md: 1rem;
    --radius-lg: 1.75rem;
    --radius-pill: 9999px;

    --state-hover: 0.08;
    --state-pressed: 0.12;
    --state-focus: 0.12;
  }

  .dark {
    --background: 222 18% 10%;
    --foreground: 0 0% 98%;

    --surface: 222 18% 10%;
    --surface-container-low: 222 18% 12%;
    --surface-container: 222 18% 14%;
    --surface-container-high: 222 18% 16%;

    --primary: 262 100% 80%;
    --on-primary: 262 55% 18%;
    --primary-container: 262 35% 28%;
    --on-primary-container: 262 100% 90%;

    --secondary-container: 220 18% 26%;
    --on-secondary-container: 220 30% 90%;

    --on-surface: 0 0% 98%;
    --on-surface-variant: 220 12% 75%;

    --outline-variant: 220 10% 30%;
    --scrim: 0 0% 0%;
    --shadow: 0 0% 0%;
  }

  body { @apply bg-background text-foreground; }
}

@layer utilities {
  .m3-state-layer {
    position: relative;
    overflow: hidden;
  }
  .m3-state-layer::after {
    content: "";
    position: absolute;
    inset: 0;
    background: currentColor;
    opacity: 0;
    transition: opacity 150ms ease;
    pointer-events: none;
  }
  .m3-state-layer:hover::after { opacity: var(--state-hover); }
  .m3-state-layer:active::after { opacity: var(--state-pressed); }
  .m3-state-layer:focus-visible::after { opacity: var(--state-focus); }
}
\`\`\`

### 2.2 \`tailwind.config.ts\` (Token Mapping) (MANDATORY)

\`\`\`typescript
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        surface: {
          DEFAULT: "hsl(var(--surface))",
          "container-low": "hsl(var(--surface-container-low))",
          container: "hsl(var(--surface-container))",
          "container-high": "hsl(var(--surface-container-high))",
        },

        primary: "hsl(var(--primary))",
        "on-primary": "hsl(var(--on-primary))",
        "primary-container": "hsl(var(--primary-container))",
        "on-primary-container": "hsl(var(--on-primary-container))",

        "secondary-container": "hsl(var(--secondary-container))",
        "on-secondary-container": "hsl(var(--on-secondary-container))",

        "on-surface": "hsl(var(--on-surface))",
        "on-surface-variant": "hsl(var(--on-surface-variant))",

        "outline-variant": "hsl(var(--outline-variant))",
        scrim: "hsl(var(--scrim))",
      },

      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-pill)",
      },

      boxShadow: {
        "1": "0 1px 2px hsl(var(--shadow) / 0.18), 0 1px 3px hsl(var(--shadow) / 0.10)",
        "2": "0 2px 6px hsl(var(--shadow) / 0.18), 0 1px 10px hsl(var(--shadow) / 0.10)",
      },

      fontSize: {
        "display-lg": ["3.5625rem", { lineHeight: "4rem", fontWeight: "400" }],
        "headline-md": ["1.75rem", { lineHeight: "2.25rem", fontWeight: "400" }],
        "title-md": ["1rem", { lineHeight: "1.5rem", fontWeight: "500" }],
        "body-lg": ["1rem", { lineHeight: "1.5rem", fontWeight: "400" }],
        "label-lg": ["0.875rem", { lineHeight: "1.25rem", fontWeight: "500" }],
      },
    },
  },
  plugins: [],
} satisfies Config;
\`\`\`

---

## SECTION 3 — shadcn/ui Component Examples 

### 3.1 MD3 Button (shadcn)

Assume you customized \`components/ui/button.tsx\` to include M3 tokens + state-layer. Usage examples (no raw buttons):

\`\`\`tsx
import { Button } from "@/components/ui/button";

export function ButtonsRow() {
  return (
    <div className="flex flex-wrap gap-4">
      <Button variant="m3Filled" size="m3">
        Get started
      </Button>

      <Button variant="m3Tonal" size="m3">
        Learn more
      </Button>

      <Button variant="m3Text" size="m3">
        Skip
      </Button>
    </div>
  );
}
\`\`\`

**Icon inside shadcn Button (48×48 touch target + fixed icon container):**

\`\`\`tsx
import { Button } from "@/components/ui/button";

export function IconButtonExample() {
  return (
    <Button variant="m3Filled" size="m3" className="gap-2">
      <span className="w-12 h-12 -ml-3 flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined">bolt</span>
      </span>
      Get started
    </Button>
  );
}
\`\`\`

**Rule:** Icons never shrink, always \`w-12 h-12 flex-shrink-0\`.

### 3.2 MD3 Card (shadcn)

\`\`\`tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function FeatureCard() {
  return (
    <Card className="bg-surface-container-low rounded-md border-0">
      <CardHeader className="flex flex-row items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined">insights</span>
        </div>

        <div className="min-w-0">
          <CardTitle className="text-title-md">Smart analytics</CardTitle>
          <p className="text-body-lg text-on-surface-variant">
            Understand usage patterns with clear, actionable insights.
          </p>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-center justify-end gap-2">
          <Button variant="m3Text" size="m3">Details</Button>
          <Button variant="m3Tonal" size="m3">Open</Button>
        </div>
      </CardContent>
    </Card>
  );
}
\`\`\`

### 3.3 MD3 Text Field (shadcn Input)

\`\`\`tsx
import { Input } from "@/components/ui/input";

export function EmailField() {
  return (
    <div className="bg-surface-container-low rounded-md h-12 px-4 flex items-center gap-3">
      <div className="w-12 h-12 flex items-center justify-center text-on-surface-variant flex-shrink-0">
        <span className="material-symbols-outlined">mail</span>
      </div>

      <Input
        className="h-12 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-body-lg placeholder:text-on-surface-variant"
        placeholder="Email address"
      />
    </div>
  );
}
\`\`\`

**Note:** shadcn Input usually adds borders/ring; you must remove them via classes.

### 3.4 MD3 Dialog (shadcn Dialog)

\`\`\`tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="m3Tonal" size="m3">Delete project</Button>
      </DialogTrigger>

      <DialogContent className="bg-surface-container-high rounded-lg border-0">
        <DialogHeader>
          <DialogTitle className="text-headline-md font-normal">Delete project?</DialogTitle>
          <DialogDescription className="text-body-lg text-on-surface-variant">
            This action can’t be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="m3Text" size="m3">Cancel</Button>
          <Button variant="m3Filled" size="m3">Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
\`\`\`

---

## SECTION 4 — Required shadcn Custom Variants (MANDATORY)

*You MUST implement these when creating or editing shadcn components*

### Button Variants

- **m3Filled:** \`bg-primary text-on-primary rounded-full h-12 px-6 m3-state-layer\`
- **m3Tonal:** \`bg-secondary-container text-on-secondary-container rounded-full h-12 px-6 m3-state-layer\`
- **m3Text:** \`text-primary rounded-full h-12 px-4 m3-state-layer\`
- **m3Icon:** \`w-12 h-12 rounded-full m3-state-layer\`

### Button Sizes

- **m3:** \`h-12\`
- **iconM3:** \`w-12 h-12\`

**Important:** You must remove default border/ring/shadow behaviors from shadcn where they conflict with M3.

---

## SECTION 5 — Self-Check Before Answering

**Before generating any code, verify:**

- [ ] No arbitrary Tailwind values in component code
- [ ] Material Symbols installed via NPM (not CDN)
- [ ] Icons are fixed \`w-12 h-12 flex-shrink-0\`
- [ ] No overlap/overflow; uses \`gap-*\` and \`min-w-0\`
- [ ] Headlines are \`font-normal\`
- [ ] Sentence case everywhere
- [ ] Surfaces define elevation; no hover-elevation
- [ ] Touch targets ≥ 48px
- [ ] Responsive design implemented </theme>`;

// Seed default themes if none exist - exported to be called from main.ts after DB init
export function seedDefaultThemes(force: boolean = false): void {
  try {
    logger.log("seedDefaultThemes called - checking existing themes...");
    const existingThemes = db.select().from(themes).all();
    logger.log(`Found ${existingThemes.length} existing themes`);

    if (force && existingThemes.length > 0) {
      logger.log("Force mode: clearing existing themes...");
      db.delete(themes).run();
    }

    logger.log("Seeding/Updating default themes...");

    const defaultThemes = [
      {
        title: "Default",
        description: "The default theme",
        prompt: DEFAULT_THEME_PROMPT,
      },
      {
        title: "Apple HIG",
        description:
          "Apple Human Interface Guidelines - Native iOS/macOS feeling",
        prompt: APPLE_HIG_THEME_PROMPT,
      },
      {
        title: "Material Design 3",
        description: "Google's Material Design 3 - Modern, accessible design",
        prompt: MATERIAL_DESIGN_3_PROMPT,
      },
      {
        title: "Minimal",
        description: "No design system constraints - Maximum creative freedom",
        prompt: "",
      },
    ];

    for (const theme of defaultThemes) {
      const existing = db
        .select()
        .from(themes)
        .where(eq(themes.title, theme.title))
        .get();

      if (existing) {
        logger.log(`Updating existing theme: ${theme.title}`);
        db.update(themes)
          .set({
            description: theme.description,
            prompt: theme.prompt,
            updatedAt: new Date(),
          })
          .where(eq(themes.id, existing.id))
          .run();
      } else {
        logger.log(`Inserting new theme: ${theme.title}`);
        const result = db
          .insert(themes)
          .values({
            title: theme.title,
            description: theme.description,
            prompt: theme.prompt,
          })
          .run();
        logger.log(`Inserted theme with id: ${result.lastInsertRowid}`);
      }
    }

    logger.log(
      `Successfully seeded/updated ${defaultThemes.length} default themes`,
    );
  } catch (error) {
    logger.error("Failed to seed default themes:", error);
    // Log more details about the error
    if (error instanceof Error) {
      logger.error("Error message:", error.message);
      logger.error("Error stack:", error.stack);
    }
  }
}

export function registerThemesHandlers() {
  // NOTE: seedDefaultThemes is now called from main.ts after database initialization

  // Add a handler to force-seed themes (useful for debugging/recovery)
  handle(
    "themes:seed",
    async (_e: IpcMainInvokeEvent, force: boolean = true): Promise<number> => {
      logger.log("Seeding themes via IPC handler (force=" + force + ")...");
      const existingThemes = db.select().from(themes).all();
      logger.log(
        `Found ${existingThemes.length} existing themes before seeding`,
      );

      seedDefaultThemes(force);

      const newThemes = db.select().from(themes).all();
      logger.log(`Found ${newThemes.length} themes after seeding`);
      return newThemes.length;
    },
  );

  handle("themes:list", async (): Promise<ThemeDto[]> => {
    logger.log("IPC: themes:list called");
    const rows = db.select().from(themes).all();
    logger.log(`IPC: themes:list found ${rows.length} themes`);
    const result = rows.map(mapRowToDto);
    logger.log(`IPC: themes:list returning: `, result);
    return result;
  });

  handle(
    "themes:get",
    async (_e: IpcMainInvokeEvent, id: number): Promise<ThemeDto | null> => {
      const row = db.select().from(themes).where(eq(themes.id, id)).get();
      return row ? mapRowToDto(row) : null;
    },
  );

  handle(
    "themes:create",
    async (
      _e: IpcMainInvokeEvent,
      params: CreateThemeParamsDto,
    ): Promise<ThemeDto> => {
      const { title, description, prompt } = params;
      if (!title) {
        throw new Error("Title is required");
      }
      const result = db
        .insert(themes)
        .values({
          title,
          description: description ?? null,
          prompt: prompt ?? "",
        })
        .run();

      const id = Number(result.lastInsertRowid);
      const row = db.select().from(themes).where(eq(themes.id, id)).get();
      if (!row) throw new Error("Failed to fetch created theme");
      return mapRowToDto(row);
    },
  );

  handle(
    "themes:update",
    async (
      _e: IpcMainInvokeEvent,
      params: UpdateThemeParamsDto,
    ): Promise<void> => {
      const { id, title, description, prompt } = params;
      if (!id) throw new Error("Theme id is required");
      if (!title) throw new Error("Title is required");
      const now = new Date();
      db.update(themes)
        .set({
          title,
          description: description ?? null,
          prompt: prompt ?? "",
          updatedAt: now,
        })
        .where(eq(themes.id, id))
        .run();
    },
  );

  handle(
    "themes:delete",
    async (_e: IpcMainInvokeEvent, id: number): Promise<void> => {
      if (!id) throw new Error("Theme id is required");
      db.delete(themes).where(eq(themes.id, id)).run();
    },
  );
}
