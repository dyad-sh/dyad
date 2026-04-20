# AI Rules — Project Reference

You are an AI coding assistant building a React web application. Follow these rules exactly. Do NOT deviate.

---

## 1. Tech Stack (DO NOT CHANGE)

| Layer       | Technology                                    |
|-------------|-----------------------------------------------|
| Language    | TypeScript (strict)                           |
| Framework   | React 18                                      |
| Build       | Vite                                          |
| Routing     | react-router-dom v6 (BrowserRouter)           |
| Styling     | Tailwind CSS                                  |
| UI Library  | shadcn/ui (local components, NOT an npm pkg)  |
| Icons       | lucide-react                                  |
| Data        | @tanstack/react-query                         |
| Forms       | react-hook-form + @hookform/resolvers + zod   |
| Charts      | recharts                                      |
| Toasts      | sonner + shadcn toast                         |

---

## 2. Project Structure

```
src/
  App.tsx          ← Router lives here. Add ALL routes here.
  main.tsx         ← Entry point. Do NOT edit.
  globals.css      ← Global Tailwind styles. Do NOT edit.
  lib/
    utils.ts       ← cn() helper. Do NOT edit.
    data.ts        ← Sample/mock data. WRITE THIS FILE FIRST before any page that imports from it.
  hooks/
    use-toast.ts   ← Toast hook. Do NOT edit.
    use-mobile.tsx ← Mobile detection hook. Do NOT edit.
  components/
    ui/            ← shadcn/ui components. Do NOT edit these files.
    (your components go here, outside ui/)
  pages/
    Index.tsx      ← Main/default page (route "/")
    NotFound.tsx   ← 404 page (route "*")
    (your pages go here)
```

### Rules:
- ALL source code goes in `src/`.
- Pages go in `src/pages/`.
- Custom components go in `src/components/` (NOT inside `src/components/ui/`).
- ALWAYS add new routes to `src/App.tsx` ABOVE the catch-all `*` route.
- ALWAYS update `src/pages/Index.tsx` or the relevant page to render new components so the user can see them.

### Sample data rule (CRITICAL):
- All mock/sample/seed data MUST live in `src/lib/data.ts` — never inline large data arrays inside components.
- `src/lib/data.ts` already exists in the project. ALWAYS write it **FIRST** in your response — before any page or component that imports from it.
- Define proper TypeScript types/interfaces for every exported value in `src/lib/data.ts`.
- Import from it using: `import { myData } from "@/lib/data";`

---

## 3. CRITICAL — Import Rules

### WARNING: `@shadcn/ui` is NOT a real npm package. NEVER do this:
```typescript
// WRONG — WILL BREAK THE BUILD:
import { Button } from "@shadcn/ui";
import { Card } from "shadcn/ui";
import { Input } from "shadcn";
```

### shadcn/ui components are LOCAL files. ALWAYS import from `@/components/ui/<name>`:

```typescript
// CORRECT — Copy these exactly:
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from "@/components/ui/menubar";
import { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger } from "@/components/ui/navigation-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Calendar } from "@/components/ui/calendar";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
```

### Other imports:
```typescript
// Icons (use any icon name from lucide-react):
import { Search, Plus, Trash2, Settings, ChevronDown, ArrowRight, X, Check, Home, User, Mail, Phone, Star, Heart, Menu, Bell, Download, Upload, Edit, Copy, Share, Filter, MoreHorizontal, MoreVertical, Loader2, AlertCircle, Info, ExternalLink, Eye, EyeOff, Lock, Unlock, Calendar as CalendarIcon, Clock, MapPin, Image, File, Folder, Code, Terminal, Zap, Sun, Moon, Github, Twitter, Facebook, Linkedin } from "lucide-react";

// Utility for merging Tailwind classes:
import { cn } from "@/lib/utils";

// Toast hook:
import { useToast } from "@/hooks/use-toast";
// Or sonner toast:
import { toast } from "sonner";

// React Router:
import { useNavigate, useParams, useSearchParams, Link, useLocation } from "react-router-dom";

// React Query:
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// React Hook Form + Zod:
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// Date utilities:
import { format, parseISO, differenceInDays, addDays, subDays, isAfter, isBefore } from "date-fns";
```

---

## 4. Styling Rules

- ALWAYS use Tailwind CSS classes. NEVER use inline styles or CSS modules.
- Use the design system colors: `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `bg-card`, `bg-accent`, `border`, `bg-destructive`.
- Use spacing utilities: `p-4`, `m-2`, `gap-4`, `space-y-4`.
- Use layout utilities: `flex`, `grid`, `items-center`, `justify-between`.
- For responsive design: `sm:`, `md:`, `lg:`, `xl:` prefixes.
- Use `cn()` to conditionally merge classes:
  ```typescript
  <div className={cn("p-4 rounded-lg", isActive && "bg-primary text-primary-foreground")} />
  ```

---

## 5. Component Patterns

### Creating a new page:
```typescript
// src/pages/Dashboard.tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const Dashboard = () => {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Content here</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
```

Then add the route to `src/App.tsx`:
```typescript
import Dashboard from "./pages/Dashboard";
// Inside <Routes>:
<Route path="/dashboard" element={<Dashboard />} />
```

### Creating a reusable component:
```typescript
// src/components/UserCard.tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface UserCardProps {
  name: string;
  email: string;
  avatarUrl?: string;
  role: "admin" | "user";
}

const UserCard = ({ name, email, avatarUrl, role }: UserCardProps) => {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <Avatar>
          <AvatarImage src={avatarUrl} alt={name} />
          <AvatarFallback>{name.charAt(0)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
        <Badge variant={role === "admin" ? "default" : "secondary"}>{role}</Badge>
      </CardContent>
    </Card>
  );
};

export default UserCard;
```

### Form pattern with validation:
```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
});

type FormData = z.infer<typeof formSchema>;

const MyForm = () => {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });

  const onSubmit = (data: FormData) => {
    toast.success("Form submitted!");
    console.log(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register("email")} />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>
      <Button type="submit">Submit</Button>
    </form>
  );
};
```

### Data fetching pattern:
```typescript
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

const DataList = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error) return <p className="text-destructive">Error loading data</p>;

  return (
    <ul className="space-y-2">
      {data?.map((item: { id: string; name: string }) => (
        <li key={item.id} className="p-2 border rounded">{item.name}</li>
      ))}
    </ul>
  );
};
```

---

## 6. State Management

- Use React `useState` and `useReducer` for local component state.
- Use `@tanstack/react-query` for server/async state.
- Lift state up to the nearest common ancestor when sharing between components.
- For complex global state, create a React context in `src/contexts/`.

---

## 7. Common Mistakes to AVOID

1. **NEVER** import from `@shadcn/ui`, `shadcn/ui`, or `shadcn`. Use `@/components/ui/<name>`.
2. **NEVER** create files inside `src/components/ui/`. Those are pre-built. Make new components in `src/components/`.
3. **NEVER** edit `src/main.tsx`, `src/globals.css`, `src/lib/utils.ts`, or anything in `src/components/ui/`.
4. **NEVER** use CSS modules, styled-components, or inline styles. Use Tailwind CSS.
5. **NEVER** install new packages without being asked. All needed packages are already installed.
6. **NEVER** use `require()`. Use ES module `import` syntax.
7. **NEVER** forget to add routes to `src/App.tsx` when creating new pages.
8. **NEVER** use `any` type. Define proper TypeScript interfaces.
9. **ALWAYS** export page components as `export default`.
10. **ALWAYS** use `key` prop when rendering lists.
11. **NEVER** render objects or arrays directly as JSX children — React cannot render them. Always access a primitive property: `{item.name}` not `{item}`. For example, `<Badge>{category.name}</Badge>` NOT `<Badge>{category}</Badge>` when `category` is an object.
12. **ALWAYS** write `src/lib/data.ts` FIRST — before any component that imports from it. If a component imports `{ foo } from "@/lib/data"` and `src/lib/data.ts` is not written in the same response, the build will fail with a missing-export error.
