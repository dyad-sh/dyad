import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

const indexPage = `import { Link } from "react-router-dom";

const Index = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-100">
    <div className="text-center">
      <h1 className="text-4xl font-bold mb-4">Home Page</h1>
      <Link to="/about" data-testid="nav-to-about">Go to About Page</Link>
    </div>
  </div>
);

export default Index;
`;

const aboutPage = `import { Link } from "react-router-dom";

const About = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-100">
    <div className="text-center">
      <h1 className="text-4xl font-bold mb-4">About Page</h1>
      <Link to="/" data-testid="nav-to-home">Go to Home Page</Link>
    </div>
  </div>
);

export default About;
`;

const app = `import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import About from "./pages/About";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
`;

export const fixture: LocalAgentFixture = {
  description: "Create a multi-page React app",
  turns: [
    {
      text: "Creating a multi-page app with navigation.",
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
            path: "src/pages/About.tsx",
            content: aboutPage,
            description: "Create the about page",
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/App.tsx",
            content: app,
            description: "Configure the app routes",
          },
        },
      ],
    },
    { text: "The multi-page app is ready." },
  ],
};
