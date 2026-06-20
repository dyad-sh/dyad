Creating a multi-page app with a route that is not declared as JSX Route elements.

<dyad-write path="src/pages/Index.tsx" description="Home page">
const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Home Page</h1>
      </div>
    </div>
  );
};

export default Index;
</dyad-write>

<dyad-write path="src/pages/ManualOnly.tsx" description="Manual route page">
const ManualOnly = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Manual Only Page</h1>
      </div>
    </div>
  );
};

export default ManualOnly;
</dyad-write>

<dyad-write path="src/App.tsx" description="App with routes declared in an object array">
import { Toaster } from "@/components/ui/toaster";
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
</dyad-write>
