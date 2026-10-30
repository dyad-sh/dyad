import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useId } from "react";

export function NeonBranchWarning({
  usage,
  onUseRecommended,
  disabled,
}: {
  usage: "deployment" | "development";
  onUseRecommended?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("home");
  const titleId = useId();
  return (
    <Alert
      role="group"
      aria-labelledby={titleId}
      variant="destructive"
      className="border-destructive/50"
    >
      <AlertTriangle />
      <div role="alert" className="col-start-2 space-y-1">
        <AlertTitle id={titleId} className="line-clamp-none">
          {t(`integrations.neon.branchSafety.${usage}Title`)}
        </AlertTitle>
        <AlertDescription className="text-destructive/90">
          <p>{t(`integrations.neon.branchSafety.${usage}Warning`)}</p>
        </AlertDescription>
      </div>
      {onUseRecommended && (
        <Button
          className="col-start-2 mt-2 h-auto max-w-full justify-self-start whitespace-normal text-left"
          disabled={disabled}
          onClick={onUseRecommended}
        >
          {t(`integrations.neon.branchSafety.${usage}Recommended`)}
        </Button>
      )}
    </Alert>
  );
}
