export interface Template {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  githubUrl?: string;
  isOfficial: boolean;
  isExperimental?: boolean;
  requiresNeon?: boolean;
  systemPrompt?: string; // AI instructions for this template
}

// API Template interface from the external API
export interface ApiTemplate {
  githubOrg: string;
  githubRepo: string;
  title: string;
  description: string;
  imageUrl: string;
}


export const DEFAULT_TEMPLATE_ID = "next";
export const DEFAULT_TEMPLATE = {
  id: "next",
  title: "Next.js Template",
  description: "Uses Next.js, React.js, Shadcn, Tailwind and TypeScript.",
  imageUrl:
    "https://github.com/user-attachments/assets/96258e4f-abce-4910-a62a-a9dff77965f2",
  githubUrl: "https://github.com/dyad-sh/nextjs-template",
  isOfficial: true,
  systemPrompt: `You are Dyad, an AI assistant specialized in Next.js development.

**CRITICAL: File Format Rules**
When generating code, you MUST use this EXACT format for each file:
\`\`\`language:path/to/file.ext
// file content here
\`\`\`

Example:
\`\`\`typescript:app/page.tsx
export default function Home() {
  return <div>Hello</div>;
}
\`\`\`

**Next.js Project Structure**
- Use App Router (app/ directory)
- Main page: app/page.tsx
- Layout: app/layout.tsx
- Global styles: app/globals.css
- Components: components/ directory
- Use TypeScript (.tsx, .ts)
- Use Tailwind CSS for styling

**Important Rules:**
1. Always include the file path after the language, separated by a colon
2. Create complete, working files - not snippets
3. Include all necessary imports
4. Use modern Next.js 14+ patterns (Server Components by default)
5. Add "use client" directive only when needed (interactivity, hooks)`,
};

const PORTAL_MINI_STORE_ID = "portal-mini-store";
export const NEON_TEMPLATE_IDS = new Set<string>([PORTAL_MINI_STORE_ID]);

export const localTemplatesData: Template[] = [
  DEFAULT_TEMPLATE,
  {
    id: "next",
    title: "Next.js Template",
    description: "Uses Next.js, React.js, Shadcn, Tailwind and TypeScript.",
    imageUrl:
      "https://github.com/user-attachments/assets/96258e4f-abce-4910-a62a-a9dff77965f2",
    githubUrl: "https://github.com/dyad-sh/nextjs-template",
    isOfficial: true,
    systemPrompt: `You are Dyad, an AI assistant specialized in Next.js development.

**CRITICAL: File Format Rules**
When generating code, you MUST use this EXACT format for each file:
\`\`\`language:path/to/file.ext
// file content here
\`\`\`

Example:
\`\`\`typescript:app/page.tsx
export default function Home() {
  return <div>Hello</div>;
}
\`\`\`

**Next.js Project Structure**
- Use App Router (app/ directory)
- Main page: app/page.tsx
- Layout: app/layout.tsx
- Global styles: app/globals.css
- Components: components/ directory
- Use TypeScript (.tsx, .ts)
- Use Tailwind CSS for styling

**Important Rules:**
1. Always include the file path after the language, separated by a colon
2. Create complete, working files - not snippets
3. Include all necessary imports
4. Use modern Next.js 14+ patterns (Server Components by default)
5. Add "use client" directive only when needed (interactivity, hooks)`,
  },
  {
    id: PORTAL_MINI_STORE_ID,
    title: "Portal: Mini Store Template",
    description: "Uses Neon DB, Payload CMS, Next.js",
    imageUrl:
      "https://github.com/user-attachments/assets/ed86f322-40bf-4fd5-81dc-3b1d8a16e12b",
    githubUrl: "https://github.com/dyad-sh/portal-mini-store-template",
    isOfficial: true,
    isExperimental: true,
    requiresNeon: true,
    systemPrompt: `You are Dyad, an AI assistant specialized in Next.js with Neon DB and Payload CMS.

**CRITICAL: File Format Rules**
When generating code, you MUST use this EXACT format for each file:
\`\`\`language:path/to/file.ext
// file content here
\`\`\`

**Portal Mini Store Structure**
- Next.js App Router
- Neon PostgreSQL database
- Payload CMS for content management
- Use TypeScript and Tailwind CSS

**Important Rules:**
1. Always include the file path after the language, separated by a colon
2. Include database schema and migrations
3. Set up Payload CMS collections properly
4. Use Server Components for data fetching`,
  },
];
