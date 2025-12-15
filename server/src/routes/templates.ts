
import { Router } from "express";

const router = Router();

const TEMPLATES = [
    {
        id: "react",
        title: "React.js Template",
        description: "Uses React.js, Vite, Shadcn, Tailwind and TypeScript.",
        imageUrl: "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
        isOfficial: true,
    },
    {
        id: "next",
        title: "Next.js Template",
        description: "Uses Next.js, React.js, Shadcn, Tailwind and TypeScript.",
        imageUrl: "https://github.com/user-attachments/assets/96258e4f-abce-4910-a62a-a9dff77965f2",
        githubUrl: "https://github.com/dyad-sh/nextjs-template",
        isOfficial: true,
    },
    {
        id: "angular",
        title: "Angular Template",
        description: "Uses Angular 17+, TypeScript and modern tooling.",
        imageUrl: "https://angular.io/assets/images/logos/angular/angular.svg", // Placeholder/Generic
        isOfficial: true,
    },
    {
        id: "vue",
        title: "Vue.js Template",
        description: "Uses Vue 3, Vite, and TypeScript.",
        imageUrl: "https://vuejs.org/images/logo.png", // Placeholder
        isOfficial: true,
    },
    {
        id: "portal-mini-store",
        title: "Portal: Mini Store Template",
        description: "Uses Neon DB, Payload CMS, Next.js",
        imageUrl: "https://github.com/user-attachments/assets/ed86f322-40bf-4fd5-81dc-3b1d8a16e12b",
        githubUrl: "https://github.com/dyad-sh/portal-mini-store-template",
        isOfficial: true,
        isExperimental: true,
        requiresNeon: true,
    }
];

router.get("/", (req, res) => {
    res.json(TEMPLATES);
});

export default router;
