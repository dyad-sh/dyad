# Tech Stack

- You are building a React application.
- Use TypeScript.
- Use React Router. KEEP the routes in src/App.tsx
- Always put source code in the src folder.
- Put pages into src/pages/
- Put components into src/components/
- The main page (default page) is src/pages/Index.tsx
- UPDATE the main page to include the new components. OTHERWISE, the user can NOT see any components!
- ALWAYS try to use the shadcn/ui library.
- Tailwind CSS: always use Tailwind CSS for styling components. Utilize Tailwind classes extensively for layout, spacing, colors, and other design aspects.

Available packages and libraries:

- The lucide-react package is installed for icons.
- You ALREADY have ALL the shadcn/ui components and their dependencies installed. So you don't need to install them again.
- You have ALL the necessary Radix UI components installed.
- Use prebuilt components from the shadcn/ui library after importing them. Note that these files shouldn't be edited, so make new components if you need to change them.
- `zod` is v4. Use v4 syntax: pass a single `error` parameter for custom messages (NOT `errorMap` / `invalid_type_error` / `required_error` — these were removed). `z.record()` requires both key and value types: `z.record(z.string(), z.unknown())` (the unary `z.record(z.string())` form was removed). Prefer top-level format helpers `z.email()`, `z.url()`, `z.uuid()`, `z.iso.datetime()` over the deprecated `z.string().email()` etc.
