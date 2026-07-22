import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";

function quoteIfSpaced(token: string): string {
  return /\s/.test(token) ? `'${token}'` : token;
}

/**
 * Consent gate for adding a local (stdio) catalog plugin. A stdio plugin
 * runs an npm package on the user's machine, so adding one asks for
 * confirmation and shows the command that will run.
 */
export function StdioCatalogConsentDialog({
  entry,
  onConfirm,
  onCancel,
}: {
  // Null (or a non-stdio entry) keeps the dialog closed; the parent
  // sets it to the pending stdio entry to open.
  entry: McpCatalogEntry | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!entry || entry.transport !== "stdio") return null;
  // Show any entry env vars as a prefix, e.g. `SOME_VAR=1 npx -y pkg@1.2.3`.
  // Quote values/args that contain whitespace so token boundaries stay
  // visible; this is for reading, not shell-safe copy-paste.
  const envPrefix = Object.entries(entry.env ?? {})
    .map(([key, value]) => `${key}=${quoteIfSpaced(value)}`)
    .join(" ");
  const fullCommand = [
    envPrefix,
    entry.command,
    ...entry.args.map(quoteIfSpaced),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Run this plugin on your computer?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <span className="block">
              <span className="text-foreground font-medium">{entry.name}</span>{" "}
              runs locally by downloading and executing an npm package on your
              computer, with the same access as any program you run.
            </span>
            <span className="block">
              Dyad curates this catalog, but the package is maintained by a
              third party and runs without a sandbox.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-xs">This will run:</p>
          <pre className="text-foreground bg-muted overflow-x-auto rounded-md p-3 text-xs">
            <code>{fullCommand}</code>
          </pre>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Add plugin</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
