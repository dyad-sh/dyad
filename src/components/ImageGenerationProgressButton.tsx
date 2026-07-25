import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useImageGenerationJobs,
  useImageGenerationPendingCount,
} from "@/image_generation/hooks";
import { ImageGenerationProgressDialog } from "./ImageGenerationProgressDialog";

export function ImageGenerationProgressButton() {
  const recentJobs = useImageGenerationJobs();
  const pendingCount = useImageGenerationPendingCount();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (recentJobs.length === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="relative"
        onClick={() => setDialogOpen(true)}
      >
        <Clock className="h-4 w-4 mr-1" />
        Recent
        {pendingCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            {pendingCount}
          </span>
        )}
      </Button>

      <ImageGenerationProgressDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
