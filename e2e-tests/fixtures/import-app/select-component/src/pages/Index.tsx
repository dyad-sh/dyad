import { Button } from "@/components/ui/button";
import { Rocket, ShieldCheck, Sparkles } from "lucide-react";

const features = [
  {
    icon: <Rocket className="w-8 h-8 text-primary mb-2" />,
    title: "Fast & Modern",
    description: "Built with the latest tech for blazing fast performance.",
  },
  {
    icon: <ShieldCheck className="w-8 h-8 text-primary mb-2" />,
    title: "Secure by Design",
    description: "Security best practices baked in from the start.",
  },
  {
    icon: <Sparkles className="w-8 h-8 text-primary mb-2" />,
    title: "Easy to Customize",
    description: "Effortlessly adapt the template to your needs.",
  },
];

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Hero Section */}
      <header className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <h1 className="text-5xl font-extrabold mb-4 text-foreground text-center">
          Launch Your Next Project
        </h1>
        <p className="text-xl text-muted-foreground mb-8 text-center max-w-xl">
          A simple, modern landing page template built with React, shadcn/ui,
          and Tailwind CSS.
        </p>
        <Button size="lg" className="px-8 py-6 text-lg">
          Get Started
        </Button>
      </header>

      {/* Features Section */}
      <section className="py-12 bg-muted">
        <div className="max-w-4xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((feature, idx) => (
              <div
                key={idx}
                className="flex flex-col items-center text-center bg-card rounded-lg p-6 shadow-sm"
              >
                {feature.icon}
                <h3 className="text-lg font-semibold mb-2 text-foreground">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;
