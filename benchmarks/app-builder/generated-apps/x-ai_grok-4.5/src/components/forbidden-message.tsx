export function ForbiddenMessage({
  title = "Access denied",
  message = "You do not have permission to view this page.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p
        data-testid="forbidden-message"
        className="rounded-lg border border-red-100 bg-red-50 px-4 py-6 text-sm text-red-700"
      >
        {message}
      </p>
    </div>
  );
}
