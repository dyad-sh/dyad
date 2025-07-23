export interface Template {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  githubUrl?: string;
  isOfficial: boolean;
}

// API Template interface from the external API
export interface ApiTemplate {
  githubOrg: string;
  githubRepo: string;
  title: string;
  description: string;
  imageUrl: string;
}

export const DEFAULT_TEMPLATE_ID = "react";
export const DEFAULT_TEMPLATE = {
  id: "react",
  title: "React.js Template",
  description: "Uses React.js, Vite, Shadcn, Tailwind and TypeScript.",
  imageUrl:
    "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
  isOfficial: true,
};

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
  },
];
