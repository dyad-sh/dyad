export type WorkspaceFocusTrigger = "pointer" | "activation" | "focus";

export function shouldFocusWorkspacePane(
  trigger: WorkspaceFocusTrigger,
  keyboardNavigationActive: boolean,
): boolean {
  return (
    trigger === "pointer" ||
    trigger === "activation" ||
    (trigger === "focus" && keyboardNavigationActive)
  );
}
