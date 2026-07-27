import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

const indexPage = `const Index = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-100">
    <h1 className="text-4xl font-bold mb-4">Home Page</h1>
  </div>
);

export default Index;
`;

const manualPage = `const ManualOnly = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-100">
    <h1 className="text-4xl font-bold mb-4">Manual Only Page</h1>
  </div>
);

export default ManualOnly;
`;

const app = `import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useRoutes } from "react-router-dom";
import Index from "./pages/Index";
import ManualOnly from "./pages/ManualOnly";

const queryClient = new QueryClient();
const routeConfig = [
  { path: "/", element: <Index /> },
  { path: "/manual-only", element: <ManualOnly /> },
];
const AppRoutes = () => useRoutes(routeConfig);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
`;

export const fixture: LocalAgentFixture = {
  description: "Create an app with a route declared in an object array",
  turns: [
    {
      text: "Creating an app with a manually configured route.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: indexPage,
            description: "Create the home page",
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/pages/ManualOnly.tsx",
            content: manualPage,
            description: "Create the manual route page",
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/App.tsx",
            content: app,
            description: "Configure object-based routes",
          },
        },
      ],
    },
    { text: "The manual route is ready." },
  ],
};
