import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    key: "welcome",
    title: "Welcome to ProteaAI",
    description:
      "The AI-native builder platform. Create production-ready apps with AI assistance — no boilerplate, no guesswork.",
  },
  {
    key: "provider",
    title: "Set up an AI provider",
    description:
      "ProteaAI uses your API keys to power the AI. You can use OpenAI, Anthropic, Google, or run models locally with Ollama.",
    hint: "You can always add or change providers later in Settings → Providers.",
  },
  {
    key: "first-app",
    title: "Create your first app",
    description:
      'Click "New App" on the home screen to describe your idea. ProteaAI will generate a working starter in seconds.',
    hint: "Try: \"A to-do app with Supabase backend\" or \"A landing page for my SaaS\".",
  },
  {
    key: "done",
    title: "You\'re all set!",
    description:
      "Your workspace is ready. Start building — or explore the Hub for ready-made templates.",
  },
] as const;

function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      navigate({ to: "/" });
    } else {
      setStep((s) => s + 1);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Step indicators */}
        <div className="flex gap-2 justify-center">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`h-1.5 w-8 rounded-full transition-colors ${
                i <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="rounded-xl border border-border bg-card p-8 space-y-4 text-center">
          {step === 0 && user?.name && (
            <p className="text-sm text-muted-foreground">
              Hi {user.name}! 👋
            </p>
          )}

          <h2 className="text-xl font-semibold">{currentStep.title}</h2>
          <p className="text-muted-foreground">{currentStep.description}</p>

          {"hint" in currentStep && currentStep.hint && (
            <p className="text-xs text-muted-foreground italic border border-border rounded-md px-3 py-2 bg-muted">
              {currentStep.hint}
            </p>
          )}
        </div>

        <div className="flex justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          <Button onClick={handleNext}>
            {isLast ? "Go to workspace →" : "Next →"}
          </Button>
        </div>

        {/* Skip */}
        {!isLast && (
          <button
            onClick={() => navigate({ to: "/" })}
            className="block w-full text-center text-xs text-muted-foreground hover:underline"
          >
            Skip onboarding
          </button>
        )}
      </div>
    </div>
  );
}

export const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: () => (
    <AuthGuard>
      <OnboardingPage />
    </AuthGuard>
  ),
});
