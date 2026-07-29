export function ForbiddenMessage() {
  return (
    <p
      data-testid="forbidden-message"
      className="rounded-lg border border-dashed border-red-300 bg-red-50 py-12 text-center text-sm text-red-600"
    >
      You don&apos;t have permission to view this page.
    </p>
  );
}
