export interface Template {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  githubUrl?: string;
  isOfficial: boolean;
  isExperimental?: boolean;
}

export const DEFAULT_TEMPLATE_ID = "react";

export const templatesData: Template[] = [
  {
    id: "react",
    title: "React.js Template",
    description: "Uses React.js, Vite, Shadcn, Tailwind and TypeScript.",
    imageUrl:
      "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
    isOfficial: true,
  },
  {
    id: "next",
    title: "Next.js Template",
    description: "Uses Next.js, React.js, Shadcn, Tailwind and TypeScript.",
    imageUrl:
      "https://github.com/user-attachments/assets/96258e4f-abce-4910-a62a-a9dff77965f2",
    githubUrl: "https://github.com/dyad-sh/nextjs-template",
    isOfficial: true,
  },
  {
    id: "mini-store",
    title: "Mini Store Template",
    description: "Uses Neon DB, Payload CMS, Next.js",
    imageUrl:
      "https://github.com/user-attachments/assets/ed86f322-40bf-4fd5-81dc-3b1d8a16e12b",
    githubUrl: "https://github.com/dyad-sh/mini-store-template",
    isOfficial: true,
    isExperimental: true,
  },
];

export function getTemplateOrThrow(templateId: string): Template {
  const template = templatesData.find((template) => template.id === templateId);
  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }
  return template;
}
