import { Lock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";

interface AnnotatorOnlyForProProps {
  onGoBack: () => void;
}

export const AnnotatorOnlyForPro = ({ onGoBack }: AnnotatorOnlyForProProps) => {
  const handleGetPro = () => {
    IpcClient.getInstance().openExternalUrl("https://dyad.sh/pro");
  };

  return (
    <div className="w-full h-full bg-background relative">
      {/* Go Back Button */}
      <button
        onClick={onGoBack}
        className="absolute top-4 left-4 p-2 hover:bg-accent rounded-md transition-all z-10 group"
        aria-label="Go back"
      >
        <ArrowLeft
          size={20}
          className="text-foreground/70 group-hover:text-foreground transition-colors"
        />
      </button>

      {/* Centered Content */}
      <div className="flex flex-col items-center justify-center h-full px-8">
        {/* Lock Icon */}
        <Lock size={72} className="text-primary/60 dark:text-primary/70 mb-8" />

        {/* Message */}
        <h2 className="text-3xl font-semibold text-foreground mb-4 text-center">
          Annotator is a Pro Feature
        </h2>
        <p className="text-muted-foreground mb-10 text-center max-w-md text-base leading-relaxed">
          Unlock the ability to annotate screenshots and enhance your workflow
          with Dyad Pro.
        </p>

        {/* Get Pro Button */}
        <Button
          onClick={handleGetPro}
          size="lg"
          className="px-8 shadow-md hover:shadow-lg transition-all"
        >
          Get Dyad Pro
        </Button>
      </div>
    </div>
  );
};
