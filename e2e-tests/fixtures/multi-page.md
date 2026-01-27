Creating a multi-page app with navigation.

<dyad-write path="src/pages/Index.tsx" description="Home page with navigation link">
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Home Page</h1>
        <Link
          to="/about"
          className="text-blue-500 hover:text-blue-700 underline"
          data-testid="nav-to-about"
        >
          Go to About Page
        </Link>
      </div>
    </div>
  );
};

export default Index;
</dyad-write>

<dyad-write path="src/pages/About.tsx" description="About page with navigation link back">
import { Link } from "react-router-dom";

const About = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">About Page</h1>
        <Link
          to="/"
          className="text-blue-500 hover:text-blue-700 underline"
          data-testid="nav-to-home"
        >
          Go to Home Page
        </Link>
      </div>
    </div>
  );
};

export default About;
</dyad-write>

<dyad-write path="src/App.tsx" description="App with router">
import { Toaster } from "@/components/ui/toaster";
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
</dyad-write>
