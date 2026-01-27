Creating a multi-page app for navigation testing...

<dyad-write path="src/pages/Index.tsx" description="Home page with link to about page">
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <div data-testid="home-page">
      <h1>Home Page</h1>
      <Link to="/about" data-testid="go-to-about-link">Go to About</Link>
    </div>
  );
};

export default Index;
</dyad-write>

<dyad-write path="src/pages/About.tsx" description="About page with link back to home">
import { Link } from "react-router-dom";

const About = () => {
  return (
    <div data-testid="about-page">
      <h1>About Page</h1>
      <Link to="/" data-testid="go-to-home-link">Go to Home</Link>
    </div>
  );
};

export default About;
</dyad-write>

<dyad-write path="src/App.tsx" description="App with router">
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import About from "./pages/About";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
</dyad-write>

Done creating multi-page app!
