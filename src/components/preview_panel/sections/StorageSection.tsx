import { HardDrive } from "lucide-react";

export function StorageSection() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <HardDrive className="w-12 h-12 text-muted-foreground" />
      <div>
        <h3 className="text-lg font-medium mb-2">Storage Management</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Storage management is coming soon. You'll be able to browse and manage
          your Supabase Storage buckets and files here.
        </p>
      </div>
    </div>
  );
}
