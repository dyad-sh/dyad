import { ArrowLeft } from "lucide-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  onClick?: () => void;
  label?: string;
  className?: string;
  fallbackTo?: string;
  "data-testid"?: string;
}

export function BackButton({
  onClick,
  label = "Go Back",
  className,
  fallbackTo = "/",
  ...rest
}: BackButtonProps) {
  const router = useRouter();
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    if (router.history.length > 1) {
      router.history.back();
    } else {
      navigate({ to: fallbackTo });
    }
  };

  return (
    <Button
      onClick={handleClick}
      variant="ghost"
      size="sm"
      className={cn(
        "group mb-4 inline-flex items-center gap-2 h-9 pl-3 pr-4 rounded-full text-muted-foreground hover:text-foreground active:scale-[0.97] transition-[colors,transform] duration-150 ease-out",
        className,
      )}
      {...rest}
    >
      <ArrowLeft className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-1" />
      <span className="text-sm font-medium">{label}</span>
    </Button>
  );
}
