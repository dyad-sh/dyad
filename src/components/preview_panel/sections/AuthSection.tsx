import { Shield } from "lucide-react";

export function AuthSection() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <Shield className="w-12 h-12 text-muted-foreground" />
      <div>
        <h3 className="text-lg font-medium mb-2">Authentication Settings</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Authentication configuration is coming soon. You'll be able to
          configure auth providers, email templates, and security settings here.
        </p>
      </div>
    </div>
  );
}
