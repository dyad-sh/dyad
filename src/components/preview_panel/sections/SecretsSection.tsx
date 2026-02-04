import { useState } from "react";
import { Key, AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import {
  useSecrets,
  useCreateSecret,
  useDeleteSecret,
} from "@/hooks/useSecrets";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { showError, showSuccess } from "@/lib/toast";

interface SecretsSectionProps {
  projectId: string;
  organizationSlug: string | null;
}

export function SecretsSection({
  projectId,
  organizationSlug,
}: SecretsSectionProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretToDelete, setSecretToDelete] = useState<string | null>(null);
  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");

  const {
    data: secrets,
    isLoading,
    error,
    isFetching,
  } = useSecrets({
    projectId,
    organizationSlug,
  });

  const createMutation = useCreateSecret({ projectId, organizationSlug });
  const deleteMutation = useDeleteSecret({ projectId, organizationSlug });

  const handleCreateSecret = async () => {
    if (!newSecretName.trim() || !newSecretValue.trim()) return;

    try {
      await createMutation.mutateAsync({
        name: newSecretName.trim(),
        value: newSecretValue.trim(),
      });
      showSuccess("Secret created successfully");
      setCreateDialogOpen(false);
      setNewSecretName("");
      setNewSecretValue("");
    } catch (err) {
      showError(err);
    }
  };

  const handleDeleteClick = (name: string) => {
    setSecretToDelete(name);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!secretToDelete) return;

    try {
      await deleteMutation.mutateAsync(secretToDelete);
      showSuccess("Secret deleted successfully");
      setDeleteDialogOpen(false);
      setSecretToDelete(null);
    } catch (err) {
      showError(err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="p-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load secrets</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const secretsList = secrets ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4" />
          <h3 className="text-sm font-medium">
            Secrets{" "}
            <span className="text-muted-foreground">
              ({secretsList.length})
            </span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            className="h-7 text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Secret
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {secretsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
            <Key className="w-12 h-12 text-muted-foreground" />
            <div>
              <h3 className="text-lg font-medium mb-2">No Secrets</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Secrets are environment variables for your Edge Functions. Add a
                secret to get started.
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-mono text-xs">Name</TableHead>
                <TableHead className="font-mono text-xs">Value</TableHead>
                <TableHead className="text-xs w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secretsList.map((secret) => (
                <TableRow key={secret.name}>
                  <TableCell className="font-mono text-xs font-medium">
                    {secret.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    ••••••••••••
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteClick(secret.name)}
                      title="Delete secret"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create Secret Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Secret</DialogTitle>
            <DialogDescription>
              Create a new secret for your Edge Functions. Secret values are
              encrypted and never displayed after creation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                placeholder="MY_SECRET_KEY"
                value={newSecretName}
                onChange={(e) => setNewSecretName(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                placeholder="Enter secret value"
                value={newSecretValue}
                onChange={(e) => setNewSecretValue(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateSecret}
              disabled={
                createMutation.isPending ||
                !newSecretName.trim() ||
                !newSecretValue.trim()
              }
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Create Secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Secret</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the secret "{secretToDelete}"?
              This action cannot be undone and may break Edge Functions that
              depend on it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
